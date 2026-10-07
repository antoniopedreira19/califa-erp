"use server";

/**
 * O "Editar orçado" do financeiro (decisão 115).
 *
 * Irmã de `registrarErrata`, com as respostas do Tiago de 28/09/2026:
 *
 * - **Só os valores** do orçado — R$ unitário, QT e D/M (P1). Tipo de custo,
 *   linha nova, linha cancelada, linha vermelha e planejado continuam sendo
 *   da errata da produção.
 * - **Linha com PP já no financeiro é editável** (P2), ao contrário da
 *   errata (decisão 040). Linha com save não: o save tem porta própria, e o
 *   banco recusa de todo jeito (`save_trava_linha_job`).
 * - **Sem aprovação e sem revisão da abertura.** A previsão de recebimento
 *   acompanha (P3), cada parcela na proporção dela e sem mudar a data; os
 *   recolhimentos de imposto (decisão 100), que precisam fechar com o
 *   imposto previsto, seguem a mesma regra. A curva de desembolso NÃO
 *   acompanha, nem no serviço Interno, em que o banco faz o planejado
 *   espelhar o orçado (Tiago, 28/09/2026: "é a previsão de recebimento que
 *   deve acompanhar").
 * - **Desde a abertura** — o job na fila, enquanto o financeiro o confere
 *   (Tiago, 28/09/2026: "desde o momento da abertura de jobs"). Ali ainda
 *   não há previsão, envio nem nota: quem acompanha é o formulário da
 *   abertura, na mesma página.
 * - **Até a primeira nota**, mesmo que parcial (P4), **ou o encerramento**
 *   do job — o que vier antes; assim o finalizado nunca edita, nem o Interno,
 *   que não tem nota. Job enviado e ainda sem nota: o envio (valor e
 *   parcelas) acompanha. No modelo mensal a trava da nota é por mês — só o
 *   mês com nota fica de fora.
 *
 * Os números antes → depois são os do FINANCEIRO (`totaisDoFinanceiro`,
 * decisão 099), os mesmos que a errata grava. Tudo é gravado numa transação
 * só, por `registrar_alteracao_do_financeiro`.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { calcularEfeitoDaMudanca } from "@/lib/calculos/versao-totais";
import { faturamentoPorMes } from "@/lib/calculos/faturamento-por-mes";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import { itensParaOFinanceiro } from "@/lib/calculos/save-financeiro";
import {
  espelhosDe,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type BaseDosEspelhos,
  type LinhaDoEspelho,
} from "@/lib/data/espelhos-do-job";
import { notasEmitidasDosJobs } from "@/lib/data/faturamento-por-job";
import { distribuirDelta as distribuir, emReais as dinheiro } from "@/lib/calculos/alteracao-financeiro";
import {
  JOB_STATUS_ABERTO,
  type EnvioDaAlteracao,
  type JobStatus,
  type PrevisaoDaAlteracao,
  type TipoCusto,
} from "@/lib/types";

type Result = { ok: true; alteracaoId: string } | { ok: false; message: string };

const linhaSchema = z.object({
  job_item_orcado_id: z.string().uuid(),
  valor_unitario: z.number().nonnegative(),
  quantidade: z.number().nonnegative(),
  dias_meses: z.number().nonnegative(),
});

const payloadSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, "O motivo da alteração precisa de pelo menos 5 caracteres.")
    .max(500, "O motivo da alteração passa de 500 caracteres."),
  linhas: z.array(linhaSchema).min(1, "Nenhuma linha alterada."),
});

export type PayloadAlteracaoFinanceiro = z.input<typeof payloadSchema>;

/** O encerramento trava a edição, como a primeira nota (Tiago, 28/09/2026):
 *  encerrado e finalizado ficam de fora. */
const MENSAGEM_JOB_ENCERRADO =
  "O job já foi encerrado: o orçado não muda mais pelo financeiro.";

const MENSAGEM_JOB_COM_NOTA =
  "O job já tem nota emitida (faturamento parcial ou total): o orçado não muda mais pelo financeiro.";

/** Previsão vazia não tem data a acompanhar: o valor novo precisaria de
 *  uma data que ninguém informou. A errata leva à revisão da abertura, que
 *  é onde a data se informa. */
const SEM_DATA_PARA_ACOMPANHAR =
  "Valor novo precisa de data: peça a errata à produção, que devolve o job para a revisão da abertura.";

/** O faturamento de cada mês (chave `yyyy-mm`) com as linhas num estado.
 *  A MESMA conta de `lerFaturamentoPorMesDoJob`, que fecha o envio do mês e
 *  a parcela do mês na abertura — por isso sem os parâmetros do
 *  internacional, como lá: a parcela que anda tem que bater com o que a
 *  abertura confere. */
function faturamentoDosMeses(
  itens: LinhaDoEspelho[],
  base: BaseDosEspelhos,
): Map<string, number> {
  const mensal = base.mensal;
  if (!mensal) return new Map();
  const vistos = itensParaOFinanceiro(itens, base.pedidos);
  const porMes = faturamentoPorMes(
    mensal.meses,
    mensal.grupos,
    vistos.map((i) => ({
      grupo_id: i.grupo_id ?? "",
      tipo_custo: i.tipo_custo,
      total_orcado: i.total_orcado,
      em_save: i.em_save,
      save_consumido: i.save_consumido,
    })),
    base.percentualHonorarios,
    base.percentualImposto,
  );
  return new Map(porMes.map((m) => [m.mes.slice(0, 7), m.faturamento]));
}

interface EnvioLido {
  id: string;
  mes: string | null;
  valor_faturado: number;
  parcelas: Array<{ id: string; ordem: number; data_vencimento: string; valor: number }>;
}

export async function registrarAlteracaoDoFinanceiro(
  jobId: string,
  payload: PayloadAlteracaoFinanceiro,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar_orcado_financeiro");
  if (!gate.ok) return gate;

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { motivo, linhas } = parsed.data;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  // ---- O job: na abertura, ou aberto e ainda não encerrado ----
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, status, data_abertura_financeiro, versao_orcamento_aprovada_id")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (jobErr || !job) return { ok: false, message: "Job não encontrado." };

  // Na fila da abertura ainda não há previsão de recebimento, recolhimento
  // de imposto, envio nem nota: nada disso anda aqui.
  const naAbertura = job.status === "aguardando_abertura";
  if (
    !naAbertura &&
    (!job.data_abertura_financeiro ||
      !JOB_STATUS_ABERTO.includes(job.status as JobStatus))
  ) {
    const encerrado = job.status === "encerrado" || job.status === "finalizado";
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.orcado_alterado_financeiro",
        motivo: encerrado ? "job_encerrado" : "job_fora_da_janela",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message: encerrado
        ? MENSAGEM_JOB_ENCERRADO
        : "O orçado só é editado pelo financeiro com o job na abertura ou já aberto no financeiro.",
    };
  }

  // ---- Tudo que a conta precisa, de uma vez (docs/PERFORMANCE.md) ----
  const [
    baseRes,
    itensRes,
    pedidosRes,
    gruposRes,
    recebimentoRes,
    impostosRes,
    enviosRes,
    notasPorJob,
  ] = await Promise.all([
    lerBaseDosEspelhos(supabase, tenantId, jobId),
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, item, grupo_id, tipo_custo, linha_vermelha, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, em_save, save_consumido, cancelada_em",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id, situacao")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .in("situacao", ["aguardando", "recusado"]),
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, mes_id")
      .eq("versao_orcamento_id", job.versao_orcamento_aprovada_id)
      .eq("tenant_id", tenantId),
    supabase
      .from("jobs_previsao_recebimento")
      .select("id, ordem, data_prevista, valor, mes")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      // A MESMA ordem em que a tela mostra o pop-up (`previsoesGravadas`):
      // a última parcela fecha o centavo, e a ordem decide qual é a última.
      .order("data_prevista")
      .order("ordem"),
    supabase
      .from("jobs_previsao_impostos")
      .select("id, ordem, data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("ordem"),
    supabase
      .from("jobs_envio_faturamento")
      .select(
        "id, mes, valor_faturado, parcelas:jobs_envio_faturamento_parcelas(id, ordem, data_vencimento, valor)",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    notasEmitidasDosJobs(tenantId, [jobId]),
  ]);

  if (!baseRes.ok) return { ok: false, message: baseRes.message };
  const base = baseRes.base;
  const erroLeitura =
    itensRes.error ??
    pedidosRes.error ??
    gruposRes.error ??
    recebimentoRes.error ??
    impostosRes.error ??
    enviosRes.error;
  if (erroLeitura || !itensRes.data) {
    // Sem saber o estado inteiro (save, envio, previsões), gravar seria
    // deixar alguma parte para trás: melhor parar.
    console.error("[alteracao-financeiro.leitura]", erroLeitura?.message);
    return { ok: false, message: "Não foi possível ler o job agora. Tente de novo." };
  }

  const mensal = base.modeloPlanilha === "mensal";
  const envios: EnvioLido[] = ((enviosRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    mes: e.mes ?? null,
    valor_faturado: Number(e.valor_faturado ?? 0),
    parcelas: ((e.parcelas ?? []) as any[])
      .map((p) => ({
        id: p.id as string,
        ordem: Number(p.ordem ?? 0),
        data_vencimento: p.data_vencimento as string,
        valor: Number(p.valor ?? 0),
      }))
      .sort((a, b) => a.ordem - b.ordem),
  }));

  // ---- A trava da nota (P4) ----
  // As notas sobre as parcelas dos envios: é por elas que o mês do mensal
  // se reconhece faturado. No job normal, qualquer nota do job trava tudo.
  const idsParcelas = envios.flatMap((e) => e.parcelas.map((p) => p.id));
  const notasDasParcelasRes =
    idsParcelas.length > 0
      ? await supabase
          .from("faturamento_itens")
          .select("envio_parcela_id, faturamento:faturamentos!inner(status)")
          .eq("tenant_id", tenantId)
          .eq("faturamento.status", "emitido")
          .in("envio_parcela_id", idsParcelas)
      : { data: [], error: null };
  if (notasDasParcelasRes.error) {
    console.error("[alteracao-financeiro.notas]", notasDasParcelasRes.error.message);
    return {
      ok: false,
      message: "Não foi possível conferir as notas emitidas deste job. Tente de novo.",
    };
  }
  const parcelasComNota = new Set(
    ((notasDasParcelasRes.data ?? []) as any[]).map((n) => n.envio_parcela_id as string),
  );
  const envioComNota = (e: EnvioLido) => e.parcelas.some((p) => parcelasComNota.has(p.id));

  if (!mensal) {
    const temNota =
      (notasPorJob.get(jobId)?.length ?? 0) > 0 || envios.some(envioComNota);
    if (temNota) return { ok: false, message: MENSAGEM_JOB_COM_NOTA };
  }

  // ---- As linhas ----
  const porId = new Map((itensRes.data as any[]).map((i) => [i.id as string, i]));
  const pedidoQuePrende = new Map<string, string>();
  for (const p of (pedidosRes.data ?? []) as any[]) {
    if (p.job_item_orcado_id) pedidoQuePrende.set(p.job_item_orcado_id, p.situacao);
  }
  const grupoPorId = new Map(
    ((gruposRes.data ?? []) as any[]).map((g) => [
      g.id as string,
      { nome: g.nome as string, mesId: (g.mes_id as string | null) ?? null },
    ]),
  );
  const mesPorId = new Map((base.mensal?.meses ?? []).map((m) => [m.id, m.mes]));
  const mesDaLinha = (grupoId: string): string | null => {
    const mesId = grupoPorId.get(grupoId)?.mesId ?? null;
    return mesId ? (mesPorId.get(mesId) ?? null) : null;
  };
  const mesesComNota = new Set(
    envios.filter((e) => e.mes && envioComNota(e)).map((e) => (e.mes as string).slice(0, 7)),
  );

  interface Mudanca {
    id: string;
    item: string;
    grupoId: string;
    grupoNome: string;
    mes: string | null;
    tipo: TipoCusto;
    unitDe: number;
    unitPara: number;
    qtdDe: number;
    qtdPara: number;
    dmDe: number;
    dmPara: number;
    totalDe: number;
    totalPara: number;
  }
  const mudancas: Mudanca[] = [];

  for (const l of linhas) {
    const atual = porId.get(l.job_item_orcado_id);
    if (!atual) {
      return { ok: false, message: "Uma das linhas alteradas não pertence a este job." };
    }
    const unitDe = Number(atual.valor_unitario_orcado ?? 0);
    const qtdDe = Number(atual.quantidade_orcada ?? 0);
    const dmDe = Number(atual.dias_meses_orcado ?? 0);
    if (l.valor_unitario === unitDe && l.quantidade === qtdDe && l.dias_meses === dmDe) {
      continue;
    }
    // Linha cancelada por errata (decisão 151): o orçado dela fica zerado.
    if (atual.cancelada_em) {
      return {
        ok: false,
        message: `"${atual.item}" foi cancelada por errata: o orçado dela fica zerado.`,
      };
    }
    if (atual.linha_vermelha === true) {
      return {
        ok: false,
        message: `"${atual.item}" é uma linha vermelha: ela não tem orçado, só recebe realizado por Pedido de Produção.`,
      };
    }
    const pedido = pedidoQuePrende.get(atual.id);
    if (
      atual.em_save === true ||
      Number(atual.save_consumido ?? 0) > 0 ||
      pedido === "aguardando" ||
      pedido === "recusado"
    ) {
      return {
        ok: false,
        message: `"${atual.item}" tem save. Linha com save não entra na edição do orçado — o save muda pelo pop-up da coluna Save.`,
      };
    }
    const mes = mesDaLinha(atual.grupo_id);
    if (mensal && mes && mesesComNota.has(mes.slice(0, 7))) {
      const nome = nomeDoMes(mes);
      return {
        ok: false,
        message: `${nome.charAt(0).toUpperCase() + nome.slice(1)} já tem nota emitida: as linhas desse mês não mudam mais pelo financeiro.`,
      };
    }
    mudancas.push({
      id: atual.id,
      item: atual.item,
      grupoId: atual.grupo_id,
      grupoNome: grupoPorId.get(atual.grupo_id)?.nome ?? "—",
      mes,
      tipo: atual.tipo_custo as TipoCusto,
      unitDe,
      unitPara: l.valor_unitario,
      qtdDe,
      qtdPara: l.quantidade,
      dmDe,
      dmPara: l.dias_meses,
      totalDe: Number(atual.total_orcado ?? 0),
      totalPara: l.valor_unitario * l.quantidade * l.dias_meses,
    });
  }

  if (mudancas.length === 0) {
    return { ok: false, message: "Nenhum valor foi alterado." };
  }

  // ---- Os números do financeiro, antes e depois ----
  const antes = totaisDoFinanceiro(base.itens, base);
  const mudancaPorId = new Map(mudancas.map((m) => [m.id, m]));
  const itensDepois: LinhaDoEspelho[] = base.itens.map((i) => {
    const m = mudancaPorId.get(i.id);
    return m ? { ...i, total_orcado: m.totalPara, valor_unitario_orcado: m.unitPara } : i;
  });
  const depois = totaisDoFinanceiro(itensDepois, base);
  const espelhos = espelhosDe(depois);

  const fatAntes = dinheiro(antes.faturamentoPrevisto);
  const fatDepois = dinheiro(depois.faturamentoPrevisto);
  const impostoAntes = dinheiro(antes.faturamento.imposto + antes.faturamento.intTaxes);
  const impostoDepois = dinheiro(depois.faturamento.imposto + depois.faturamento.intTaxes);

  // ---- A previsão de recebimento e o envio acompanham (P3, P4) ----
  const recebimentoAtual = ((recebimentoRes.data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    data_prevista: r.data_prevista as string,
    mes: (r.mes as string | null) ?? null,
    valor: Number(r.valor ?? 0),
  }));
  let recebimentoNovo = recebimentoAtual;
  const enviosNovos = new Map<string, EnvioLido>();

  if (mensal) {
    // Cada mês recebe o que ele fatura: só os meses mexidos andam.
    const fatMesAntes = faturamentoDosMeses(base.itens, base);
    const fatMesDepois = faturamentoDosMeses(itensDepois, base);
    const mesesMexidos = new Set(
      mudancas.map((m) => m.mes?.slice(0, 7)).filter((m): m is string => !!m),
    );
    for (const chave of mesesMexidos) {
      const delta = dinheiro((fatMesDepois.get(chave) ?? 0) - (fatMesAntes.get(chave) ?? 0));
      const doMes = recebimentoNovo.filter((r) => r.mes?.slice(0, 7) === chave);
      if (!naAbertura && doMes.length === 0 && Math.abs(delta) >= 0.005) {
        const nome = nomeDoMes(`${chave}-01`);
        return {
          ok: false,
          message: `${nome.charAt(0).toUpperCase() + nome.slice(1)} não tinha faturamento na abertura e não tem previsão de recebimento para acompanhar a alteração. ${SEM_DATA_PARA_ACOMPANHAR}`,
        };
      }
      const novos = new Map(distribuir(doMes, delta).map((r) => [r.id, r]));
      recebimentoNovo = recebimentoNovo.map((r) => novos.get(r.id) ?? r);

      const envio = envios.find((e) => e.mes?.slice(0, 7) === chave);
      if (envio && !envioComNota(envio) && Math.abs(delta) >= 0.005) {
        enviosNovos.set(envio.id, {
          ...envio,
          valor_faturado: dinheiro(envio.valor_faturado + delta),
          parcelas: distribuir(envio.parcelas, delta),
        });
      }
    }
  } else {
    const delta = dinheiro(fatDepois - fatAntes);
    if (!naAbertura && recebimentoAtual.length === 0 && Math.abs(delta) >= 0.005) {
      return {
        ok: false,
        message: `O job abriu sem faturamento previsto e não tem previsão de recebimento para acompanhar a alteração. ${SEM_DATA_PARA_ACOMPANHAR}`,
      };
    }
    recebimentoNovo = distribuir(recebimentoAtual, delta);
    const envio = envios.find((e) => e.mes === null);
    // Linha que não mexe no faturamento (FI, por exemplo) não toca no envio.
    if (envio && Math.abs(delta) >= 0.005) {
      enviosNovos.set(envio.id, {
        ...envio,
        valor_faturado: dinheiro(envio.valor_faturado + delta),
        parcelas: distribuir(envio.parcelas, delta),
      });
    }
  }

  const impostosAtuais = ((impostosRes.data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    data_prevista: r.data_prevista as string,
    valor: Number(r.valor ?? 0),
  }));
  const impostosNovos = distribuir(impostosAtuais, dinheiro(impostoDepois - impostoAntes));

  // A curva de desembolso não acompanha, nem no Interno, em que o planejado
  // muda junto com o orçado (Tiago, 28/09/2026). Quem ajusta é o financeiro,
  // no Editar registro da aba Abertura do Job.

  // O envio não aceita parcela sem valor (`chk_envio_parcela_valor_positivo`),
  // e não se desfaz: melhor a frase aqui do que o erro de constraint.
  const envioZerado = [...enviosNovos.values()].some(
    (e) => e.valor_faturado <= 0 || e.parcelas.some((p) => p.valor <= 0),
  );
  if (envioZerado) {
    return {
      ok: false,
      message:
        "Com essa alteração, uma parcela do envio para faturamento ficaria zerada ou negativa, e o envio não aceita parcela sem valor.",
    };
  }

  const foto = (ls: Array<{ data_prevista: string; valor: number }>): PrevisaoDaAlteracao[] =>
    ls.map((l) => ({ data_prevista: l.data_prevista, valor: l.valor }));
  const fotoEnvio = (e: EnvioLido): EnvioDaAlteracao => ({
    mes: e.mes,
    valor_faturado: e.valor_faturado,
    parcelas: e.parcelas.map((p) => ({ data_vencimento: p.data_vencimento, valor: p.valor })),
  });
  const enviosTocados = envios.filter((e) => enviosNovos.has(e.id));

  // O efeito de cada linha, com a última fechando o centavo: honorário e
  // imposto são lineares, mas cada efeito arredondado à parte pode somar 1
  // centavo diferente do antes → depois do job — e o card mostraria um
  // total que não bate com as linhas.
  const efeitos = mudancas.map((m) =>
    calcularEfeitoDaMudanca(
      { total: m.totalDe, tipoCusto: m.tipo },
      { total: m.totalPara, tipoCusto: m.tipo },
      base.percentualHonorarios,
      base.percentualImposto,
      base.internacional,
    ),
  );
  const efeitoJob = distribuir(
    efeitos.map((e) => ({ valor: dinheiro(e.valorJob) })),
    dinheiro(
      dinheiro(depois.valorJob) -
        dinheiro(antes.valorJob) -
        efeitos.reduce((s, e) => s + dinheiro(e.valorJob), 0),
    ),
  );
  const efeitoFat = distribuir(
    efeitos.map((e) => ({ valor: dinheiro(e.faturamentoPrevisto) })),
    dinheiro(
      fatDepois - fatAntes - efeitos.reduce((s, e) => s + dinheiro(e.faturamentoPrevisto), 0),
    ),
  );

  // ---- Grava tudo numa transação só ----
  const { data: alteracaoId, error: gravarErr } = await supabase.rpc(
    "registrar_alteracao_do_financeiro",
    {
      p_job_id: jobId,
      p: {
        alteracao: {
          motivo,
          custo_orcado_antes: dinheiro(antes.subtotalGeral),
          custo_orcado_depois: dinheiro(depois.subtotalGeral),
          valor_job_antes: dinheiro(antes.valorJob),
          valor_job_depois: dinheiro(depois.valorJob),
          faturamento_previsto_antes: fatAntes,
          faturamento_previsto_depois: fatDepois,
          recebimento_antes: foto(recebimentoAtual),
          recebimento_depois: foto(recebimentoNovo),
          impostos_antes: foto(impostosAtuais),
          impostos_depois: foto(impostosNovos),
          envio_antes: enviosTocados.map(fotoEnvio),
          envio_depois: enviosTocados.map((e) => fotoEnvio(enviosNovos.get(e.id) as EnvioLido)),
        },
        itens: mudancas.map((m, k) => {
          return {
            job_item_orcado_id: m.id,
            item_nome: m.item,
            grupo_nome: m.grupoNome,
            mes: m.mes,
            tipo_custo: m.tipo,
            valor_unitario_de: m.unitDe,
            valor_unitario_para: m.unitPara,
            quantidade_de: m.qtdDe,
            quantidade_para: m.qtdPara,
            dias_meses_de: m.dmDe,
            dias_meses_para: m.dmPara,
            total_de: dinheiro(m.totalDe),
            total_para: dinheiro(m.totalPara),
            efeito_valor_job: efeitoJob[k].valor,
            efeito_faturamento_previsto: efeitoFat[k].valor,
          };
        }),
        linhas: mudancas.map((m) => ({
          id: m.id,
          valor_unitario_orcado: m.unitPara,
          quantidade_orcada: m.qtdPara,
          dias_meses_orcado: m.dmPara,
        })),
        envios: [...enviosNovos.values()].map((e) => ({ id: e.id, valor_faturado: e.valor_faturado })),
        parcelas_envio: [...enviosNovos.values()].flatMap((e) =>
          e.parcelas.map((p) => ({ id: p.id, valor: p.valor })),
        ),
        recebimento: recebimentoNovo
          .filter((r, k) => r.valor !== recebimentoAtual[k]?.valor)
          .map((r) => ({ id: r.id, valor: r.valor })),
        impostos: impostosNovos
          .filter((r, k) => r.valor !== impostosAtuais[k]?.valor)
          .map((r) => ({ id: r.id, valor: r.valor })),
        espelhos,
      },
    },
  );

  if (gravarErr || !alteracaoId) {
    console.error("[alteracao-financeiro.gravar]", gravarErr?.message);
    // P0001 é mensagem nossa, escrita para a tela (as travas do banco).
    const doBanco =
      gravarErr?.code === "P0001" && gravarErr.message ? ` ${gravarErr.message}` : "";
    return {
      ok: false,
      message: `Não foi possível registrar a alteração, e nada foi gravado.${doBanco}`,
    };
  }

  await logAuditEvent({
    acao: "job.orcado_alterado_financeiro",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      alteracao_id: alteracaoId,
      motivo,
      itens_alterados: mudancas.length,
      valor_job_antes: dinheiro(antes.valorJob),
      valor_job_depois: dinheiro(depois.valorJob),
      faturamento_previsto_antes: fatAntes,
      faturamento_previsto_depois: fatDepois,
      envios_acompanharam: enviosTocados.length,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
  return { ok: true, alteracaoId: alteracaoId as string };
}
