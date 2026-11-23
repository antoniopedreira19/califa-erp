"use server";

/**
 * Encerrar a veiculação antes do fim e estender (decisão 275, entrega 5 da
 * Mídia Off). As contas saem daqui — as linhas novas, a conta da mídia, o
 * faturamento de cada mês, os espelhos do job e as previsões do financeiro
 * — e `registrar_alteracao_da_midia` grava tudo numa transação só, como a
 * errata faz com a função dela.
 *
 * Regras do Tiago: o cliente paga só o que foi ao ar (1c: proporcional
 * sugerido e editável no período); a extensão é linha nova, sem planejado
 * inicial, e o mês entra no job se não estiver nele; o mês enviado não
 * muda; o motivo é opcional; nada passa pela errata; a previsão de
 * recebimento (e a de impostos) acompanha a diferença de cada mês
 * (23/11/2026, "Ajusta sozinha"). Quem faz: administrador e GP — os mesmos
 * que enviam o mês ao faturamento.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { jobAceitaAcoesPlanilha, type JobStatus } from "@/lib/types";
import { lerMidiaDoJob } from "@/lib/data/midia-do-job";
import { mesesEnviadosDoJob } from "@/lib/data/envio-faturamento";
import {
  espelhosDe,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type LinhaDoEspelho,
} from "@/lib/data/espelhos-do-job";
import { distribuirDelta } from "@/lib/calculos/alteracao-financeiro";
import {
  cortarLinha,
  fechamentoDosItens,
  linhaDaExtensao,
  nomeDoMesMidia,
  planejadoDaLinhaMidia,
  veiculaDepois,
  type ParametrosMidia,
} from "@/lib/calculos/midia-off";

type Resultado = { ok: true } | { ok: false; message: string };

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Uma linha da cópia do job, com o mês do agrupamento (a âncora). */
interface LinhaLida {
  id: string;
  item: string;
  grupo_id: string;
  tipo_custo: string;
  em_save: boolean | null;
  save_consumido: number | string | null;
  valor_unitario_orcado: number | string | null;
  quantidade_orcada: number | string | null;
  dias_meses_orcado: number | string | null;
  total_orcado: number | string | null;
  insercoes_por_dia: Record<string, number> | null;
  data_inicio: string | null;
  data_fim: string | null;
  cancelada_em: string | null;
  /** `YYYY-MM-01`. */
  mes: string;
}

interface Contexto {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  jobId: string;
  jobCodigo: string;
  params: ParametrosMidia;
  linhas: LinhaLida[];
  enviados: Set<string>;
  base: Awaited<ReturnType<typeof lerBaseDosEspelhos>> & { ok: true };
  recebimento: Array<{ id: string; mes: string | null; data_prevista: string; valor: number }>;
  impostos: Array<{ id: string; valor: number }>;
}

/** As portas e as leituras comuns às duas ações. */
async function carregar(jobId: string): Promise<{ ok: true; c: Contexto } | { ok: false; message: string }> {
  const session = await requireSession();
  // Muda o faturamento do mês: é de quem envia o mês (administrador e GP).
  const gate = await checarPermissao(session, "jobs.enviar_faturamento");
  if (!gate.ok) return gate;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [jobRes, lida, linhasRes, enviados, base, recRes, impRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, codigo, status, abertura_em_revisao")
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; codigo: string; status: JobStatus; abertura_em_revisao: boolean | null }>(),
    lerMidiaDoJob(supabase, tenantId, jobId),
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, item, grupo_id, tipo_custo, em_save, save_consumido, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, insercoes_por_dia, data_inicio, data_fim, cancelada_em, " +
          "grupo:versoes_orcamento_grupos!jobs_itens_orcado_grupo_id_fkey(mes:versoes_orcamento_meses!versoes_orcamento_grupos_mes_da_mesma_versao_fkey(mes))",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("ordem", { ascending: true }),
    mesesEnviadosDoJob(supabase, jobId, tenantId).catch(() => null),
    lerBaseDosEspelhos(supabase, tenantId, jobId, { comMeses: false }),
    supabase
      .from("jobs_previsao_recebimento")
      .select("id, mes, data_prevista, valor, ordem")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_previsao_impostos")
      .select("id, valor, ordem")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("ordem", { ascending: true }),
  ]);
  const job = jobRes.data;
  if (!job) return { ok: false, message: "Job não encontrado." };
  if (!jobAceitaAcoesPlanilha(job.status)) {
    return { ok: false, message: "A veiculação só muda com o job aberto." };
  }
  if (!lida.ok || linhasRes.error || enviados === null || !base.ok || recRes.error || impRes.error) {
    console.error(
      "[midia.realizado.ler]",
      linhasRes.error?.message ?? recRes.error?.message ?? impRes.error?.message ?? (!base.ok ? base.message : ""),
    );
    return { ok: false, message: "Não foi possível conferir o job. Tente de novo." };
  }
  if (!lida.midia) return { ok: false, message: "Este job não é de Mídia Off." };

  const linhas: LinhaLida[] = ((linhasRes.data ?? []) as any[]).map((l) => {
    const grupo = Array.isArray(l.grupo) ? l.grupo[0] : l.grupo;
    const m = Array.isArray(grupo?.mes) ? grupo.mes[0] : grupo?.mes;
    return { ...l, mes: String(m?.mes ?? "").slice(0, 10) };
  });

  return {
    ok: true,
    c: {
      supabase,
      tenantId,
      jobId,
      jobCodigo: job.codigo,
      params: lida.midia,
      linhas,
      enviados: new Set([...enviados].map((m) => String(m).slice(0, 10))),
      base,
      recebimento: ((recRes.data ?? []) as any[]).map((r) => ({
        id: r.id,
        mes: r.mes ? String(r.mes).slice(0, 10) : null,
        data_prevista: String(r.data_prevista).slice(0, 10),
        valor: Number(r.valor ?? 0),
      })),
      impostos: ((impRes.data ?? []) as any[]).map((r) => ({ id: r.id, valor: Number(r.valor ?? 0) })),
    },
  };
}

/** As linhas vivas no formato da conta. */
function vivas(linhas: LinhaLida[]) {
  return linhas.filter((l) => !l.cancelada_em);
}

/** O faturamento de cada mês (`YYYY-MM-01`), pela conta da mídia. */
function faturamentoPorMes(linhas: LinhaLida[], p: ParametrosMidia): Map<string, number> {
  const porMes = new Map<string, LinhaLida[]>();
  for (const l of vivas(linhas)) porMes.set(l.mes, [...(porMes.get(l.mes) ?? []), l]);
  return new Map(
    [...porMes.entries()].map(([mes, ls]) => [
      mes,
      r2(fechamentoDosItens(ls.map((l) => ({ tipo_custo: l.tipo_custo, total_orcado: l.total_orcado })), p).faturamentoPrevisto),
    ]),
  );
}

/** O dia do recebimento de um mês sem previsão: o mesmo dia e a mesma
 *  distância do mês da última previsão (dezembro recebe em 10/01 → janeiro
 *  recebe em 10/02). Sem previsão nenhuma, o dia 10 do mês seguinte. */
function dataDoMesNovo(mes: string, recebimento: Contexto["recebimento"]): string {
  const ultima = [...recebimento].filter((r) => r.mes).sort((a, b) => a.mes!.localeCompare(b.mes!)).pop();
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  let lag = 1;
  let dia = 10;
  if (ultima) {
    const [ra, rm] = ultima.mes!.slice(0, 7).split("-").map(Number);
    const [pa, pm, pd] = ultima.data_prevista.split("-").map(Number);
    lag = pa * 12 + pm - (ra * 12 + rm);
    dia = pd;
  }
  const t = a * 12 + (m - 1) + lag;
  const ano = Math.floor(t / 12);
  const mm = (t % 12) + 1;
  const ultimoDia = new Date(Date.UTC(ano, mm, 0)).getUTCDate();
  return `${ano}-${String(mm).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

/** Os espelhos e as previsões depois da mudança. */
function contasDaMudanca(c: Contexto, depois: LinhaLida[]) {
  const comoEspelho = (ls: LinhaLida[]): LinhaDoEspelho[] =>
    ls.map((l) => ({
      id: l.id,
      item: l.item,
      grupo_id: l.grupo_id,
      tipo_custo: l.tipo_custo as LinhaDoEspelho["tipo_custo"],
      total_orcado: Number(l.total_orcado ?? 0),
      valor_unitario_orcado: Number(l.valor_unitario_orcado ?? 0),
      em_save: l.em_save === true,
      save_consumido: Number(l.save_consumido ?? 0),
    }));
  const totaisAntes = totaisDoFinanceiro(comoEspelho(c.linhas), c.base.base);
  const totaisDepois = totaisDoFinanceiro(comoEspelho(depois), c.base.base);

  // A previsão de recebimento acompanha a diferença de cada mês.
  const antes = faturamentoPorMes(c.linhas, c.params);
  const agora = faturamentoPorMes(depois, c.params);
  let recebimento = c.recebimento;
  const criar: Array<{ mes: string; data_prevista: string; valor: number }> = [];
  for (const mes of new Set([...antes.keys(), ...agora.keys()])) {
    const delta = r2((agora.get(mes) ?? 0) - (antes.get(mes) ?? 0));
    if (Math.abs(delta) < 0.005) continue;
    const doMes = recebimento.filter((r) => r.mes === mes);
    if (doMes.length === 0) {
      if (delta > 0) criar.push({ mes, data_prevista: dataDoMesNovo(mes, c.recebimento), valor: delta });
      continue;
    }
    const novos = new Map(distribuirDelta(doMes, delta).map((r) => [r.id, r]));
    recebimento = recebimento.map((r) => novos.get(r.id) ?? r);
  }
  const atualizar = recebimento
    .filter((r) => Math.abs(r.valor - (c.recebimento.find((x) => x.id === r.id)?.valor ?? r.valor)) >= 0.005)
    .map((r) => ({ id: r.id, valor: r2(r.valor) }));

  // A de impostos, pela diferença do imposto do job.
  // Na mídia o imposto é o campo plano do fechamento (`comAContaDaMidia`):
  // alíquota × honorários.
  const deltaImposto = r2(totaisDepois.imposto - totaisAntes.imposto);
  const impostos = distribuirDelta(c.impostos, deltaImposto)
    .filter((r) => Math.abs(r.valor - (c.impostos.find((x) => x.id === r.id)?.valor ?? r.valor)) >= 0.005)
    .map((r) => ({ id: r.id, valor: r2(r.valor) }));

  return {
    espelhos: espelhosDe(totaisDepois),
    recebimento: { atualizar, criar },
    impostos: { atualizar: impostos },
    fatAntes: totaisAntes.faturamentoPrevisto,
    fatDepois: totaisDepois.faturamentoPrevisto,
  };
}

function fotoDaLinha(l: {
  quantidade_orcada: number | string | null;
  dias_meses_orcado: number | string | null;
  insercoes_por_dia: Record<string, number> | null;
  data_inicio?: string | null;
  data_fim: string | null;
  total: number;
}) {
  return {
    quantidade_orcada: Number(l.quantidade_orcada ?? 0),
    dias_meses_orcado: Number(l.dias_meses_orcado ?? 0),
    insercoes_por_dia: l.insercoes_por_dia,
    data_inicio: l.data_inicio ?? null,
    data_fim: l.data_fim,
    negociado: r2(l.total),
  };
}

function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(a, m, 0, 12)).toISOString().slice(0, 10);
}

/** Encerrar a veiculação antes do fim: as linhas marcadas param no dia. */
export async function encerrarVeiculacaoAntes(
  jobId: string,
  input: { ultimoDia: string; linhas: Array<{ id: string; valor: number | null }>; motivo: string | null },
): Promise<Resultado> {
  const ultimoDia = String(input?.ultimoDia ?? "");
  if (!DATA_ISO.test(ultimoDia)) return { ok: false, message: "Escolha o último dia no ar." };
  const pedidas = Array.isArray(input?.linhas) ? input.linhas : [];
  if (pedidas.length === 0) return { ok: false, message: "Marque ao menos uma linha." };
  const motivo = input?.motivo ? String(input.motivo).trim().slice(0, 500) : null;

  const lido = await carregar(jobId);
  if (!lido.ok) return lido;
  const c = lido.c;

  const linhasRpc: any[] = [];
  const depois = c.linhas.map((l) => ({ ...l }));
  for (const pedida of pedidas) {
    const i = depois.findIndex((l) => l.id === pedida.id);
    const l = depois[i];
    if (!l || l.cancelada_em) return { ok: false, message: "Uma das linhas não é deste job. Recarregue a página." };
    if (c.enviados.has(l.mes)) {
      return { ok: false, message: `${nomeDoMesMidia(l.mes)} já foi ao faturamento: as linhas dele não mudam.` };
    }
    if (!veiculaDepois(l, l.mes, ultimoDia)) {
      return { ok: false, message: "Uma das linhas não vai ao ar depois desse dia. Recarregue a página." };
    }
    const atual = Number(l.total_orcado ?? 0);
    const valor = pedida.valor === null || pedida.valor === undefined ? null : Number(pedida.valor);
    if (valor !== null && (!(valor >= 0) || valor > atual + 0.005)) {
      return { ok: false, message: "O valor de uma linha encerrada passa do que ela tinha. Confira os valores." };
    }
    const corte = cortarLinha(l, l.mes, ultimoDia, valor);
    if (!corte) continue;
    linhasRpc.push({
      id: l.id,
      quantidade_orcada: corte.quantidade_orcada,
      dias_meses_orcado: corte.dias_meses_orcado,
      insercoes_por_dia: corte.insercoes_por_dia,
      data_fim: corte.data_fim,
      antes: fotoDaLinha({ ...l, total: atual }),
      depois: { ...fotoDaLinha({ ...corte, total: corte.total }), dias_cortados: corte.diasCortados },
      negociado_antes: r2(atual),
      negociado_depois: r2(corte.total),
    });
    depois[i] = {
      ...l,
      quantidade_orcada: corte.quantidade_orcada,
      dias_meses_orcado: corte.dias_meses_orcado,
      insercoes_por_dia: corte.insercoes_por_dia,
      data_fim: corte.data_fim,
      total_orcado: corte.total,
    };
  }
  if (linhasRpc.length === 0) return { ok: false, message: "Nenhuma linha muda com esse dia." };

  const contas = contasDaMudanca(c, depois);
  const { error } = await c.supabase.rpc("registrar_alteracao_da_midia", {
    p_job_id: jobId,
    p: {
      tipo: "encerramento",
      data: ultimoDia,
      motivo,
      linhas: linhasRpc,
      espelhos: contas.espelhos,
      recebimento: contas.recebimento,
      impostos: contas.impostos,
    },
  });
  if (error) {
    console.error("[midia.realizado.encerrar]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível encerrar a veiculação.") };
  }

  await logAuditEvent({
    acao: "midia.veiculacao_encerrada",
    tenantId: c.tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      ultimo_dia: ultimoDia,
      linhas: linhasRpc.map((l) => ({ id: l.id, de: l.negociado_antes, para: l.negociado_depois })),
      faturamento_de: r2(contas.fatAntes),
      faturamento_para: r2(contas.fatDepois),
      motivo,
    },
  });
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Estender a veiculação: uma linha nova, no mesmo unitário da de origem. */
export async function estenderVeiculacao(
  jobId: string,
  input: {
    baseId: string;
    mes: string;
    dias: Record<string, number> | null;
    inicio: string | null;
    fim: string | null;
    valor: number | null;
    motivo: string | null;
  },
): Promise<Resultado> {
  const mes = String(input?.mes ?? "");
  if (!/^\d{4}-\d{2}-01$/.test(mes)) return { ok: false, message: "Escolha o mês da extensão." };
  const motivo = input?.motivo ? String(input.motivo).trim().slice(0, 500) : null;

  const lido = await carregar(jobId);
  if (!lido.ok) return lido;
  const c = lido.c;

  const base = c.linhas.find((l) => l.id === input?.baseId && !l.cancelada_em);
  if (!base) return { ok: false, message: "A linha da extensão não é deste job. Recarregue a página." };
  if (c.enviados.has(mes)) {
    return { ok: false, message: `${nomeDoMesMidia(mes)} já foi ao faturamento: não recebe extensão.` };
  }
  // O mês da linha ou um dos dois seguintes, como o pop-up oferece.
  const t = (x: string) => Number(x.slice(0, 4)) * 12 + Number(x.slice(5, 7));
  if (t(mes) < t(base.mes) || t(mes) > t(base.mes) + 2) {
    return { ok: false, message: "A extensão vai no mês da linha ou num dos dois seguintes." };
  }

  let nova: ReturnType<typeof linhaDaExtensao>;
  if (base.insercoes_por_dia) {
    const dias = Object.fromEntries(
      Object.entries(input?.dias ?? {})
        .map(([d, n]) => [String(Number(d)), Math.round(Number(n))] as const)
        .filter(([d, n]) => n > 0 && Number(d) >= 1 && Number(d) <= Number(ultimoDiaDoMes(mes).slice(8, 10))),
    );
    if (Object.keys(dias).length === 0) return { ok: false, message: "Marque os dias da extensão." };
    nova = linhaDaExtensao(base, { forma: "grade", dias });
  } else {
    const inicio = String(input?.inicio ?? "");
    const fim = String(input?.fim ?? "");
    const valor = Number(input?.valor ?? 0);
    if (!DATA_ISO.test(inicio) || !DATA_ISO.test(fim) || fim < inicio) {
      return { ok: false, message: "Escolha o início e o fim da extensão." };
    }
    if (inicio.slice(0, 7) !== mes.slice(0, 7)) {
      return { ok: false, message: "A extensão começa no mês escolhido: a linha mora no mês em que começa." };
    }
    if (!(valor > 0)) return { ok: false, message: "Informe o negociado da extensão." };
    nova = linhaDaExtensao(base, { forma: "periodo", inicio, fim, valor });
  }
  if (!(nova.total > 0)) return { ok: false, message: "A extensão precisa ter valor." };

  const planejado = planejadoDaLinhaMidia(
    {
      valor_unitario_orcado: base.valor_unitario_orcado,
      quantidade_orcada: nova.quantidade_orcada,
      dias_meses_orcado: nova.dias_meses_orcado,
    },
    c.params,
  );
  const depois: LinhaLida[] = [
    ...c.linhas,
    {
      ...base,
      id: "extensao",
      mes,
      quantidade_orcada: nova.quantidade_orcada,
      dias_meses_orcado: nova.dias_meses_orcado,
      insercoes_por_dia: nova.insercoes_por_dia,
      data_inicio: nova.data_inicio,
      data_fim: nova.data_fim,
      total_orcado: nova.total,
    },
  ];
  const contas = contasDaMudanca(c, depois);
  const { error } = await c.supabase.rpc("registrar_alteracao_da_midia", {
    p_job_id: jobId,
    p: {
      tipo: "extensao",
      data: mes,
      motivo,
      extensao: {
        base_id: base.id,
        mes,
        quantidade_orcada: nova.quantidade_orcada,
        dias_meses_orcado: nova.dias_meses_orcado,
        // O planejado da linha do job de mídia é a nota do veículo (decisão
        // 273): é a referência da PP do repasse. O "sem planejado" da
        // extensão é o do registro — não há planejado INICIAL.
        valor_unitario_planejado: planejado.valor_unitario_planejado,
        quantidade_planejada: planejado.quantidade_planejada,
        dias_meses_planejado: planejado.dias_meses_planejado,
        insercoes_por_dia: nova.insercoes_por_dia,
        data_inicio: nova.data_inicio,
        data_fim: nova.data_fim,
        negociado: r2(nova.total),
        depois: fotoDaLinha({ ...nova, total: nova.total }),
      },
      espelhos: contas.espelhos,
      recebimento: contas.recebimento,
      impostos: contas.impostos,
    },
  });
  if (error) {
    console.error("[midia.realizado.estender]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível estender a veiculação.") };
  }

  await logAuditEvent({
    acao: "midia.veiculacao_estendida",
    tenantId: c.tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      base_id: base.id,
      mes,
      negociado: r2(nova.total),
      mes_novo: !c.linhas.some((l) => l.mes === mes),
      faturamento_de: r2(contas.fatAntes),
      faturamento_para: r2(contas.fatDepois),
      motivo,
    },
  });
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** A recusa da função fala português; o resto vira a mensagem genérica. */
function mensagemDoBanco(mensagem: string, generica: string): string {
  const conhecidas = [
    "Só o administrador",
    "A veiculação só muda",
    "já foi ao faturamento",
    "não é deste job",
    "Recarregue a página",
  ];
  return conhecidas.some((k) => mensagem.includes(k)) ? mensagem : generica;
}
