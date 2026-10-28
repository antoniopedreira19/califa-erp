"use server";

/**
 * Os parâmetros do job editados pelo financeiro (decisão 224).
 *
 * Irmã do "Editar orçado" (decisão 115, `registrarAlteracaoDoFinanceiro`),
 * com as respostas do Tiago de 27/10/2026:
 *
 * - **O quê:** honorários/fee e impostos em todo modelo; no internacional
 *   também int. taxes, Impostos BR e custo de transação (sem passar pela
 *   Exceção do administrador da decisão 206) e o câmbio; na Mídia Off, a
 *   base dos honorários e a parte do veículo.
 * - **Onde grava:** no JOB (`jobs_parametros`). A versão aprovada continua
 *   como o cliente aprovou.
 * - **Quando:** na fila da abertura e, desde 28/10/2026, também com o job
 *   aberto, com as regras do "Editar orçado": até a primeira nota emitida
 *   (no mensal, qualquer mês com nota — os parâmetros mexem em todos os
 *   meses) ou o encerramento. O câmbio, que não muda conta em reais, segue
 *   editável até o encerramento mesmo com nota.
 * - **Motivo obrigatório**, no pop-up do Salvar, e o registro vai para
 *   Alterações do Financeiro.
 *
 * Na fila ainda não há previsão de recebimento, recolhimento de imposto,
 * envio nem nota: o que acompanha é o formulário da aba Abertura do Job,
 * que lê os números novos do servidor. Com o job aberto, acompanham como no
 * "Editar orçado" (P3, P4): a previsão de recebimento (no mensal, mês a
 * mês), os recolhimentos de imposto e o envio para faturamento ainda sem
 * nota, cada parcela na proporção dela e com a mesma data. Tudo é gravado
 * numa transação só, por `registrar_alteracao_do_financeiro`.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { isAliquotaConhecida } from "@/lib/impostos";
import {
  compraDaCotacao,
  cotacaoValida,
  vendaDaCotacao,
} from "@/lib/calculos/excecao-fechamento";
import { parametrosDaVersao } from "@/lib/calculos/midia-off";
import { distribuirDelta as distribuir, emReais as dinheiro } from "@/lib/calculos/alteracao-financeiro";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import {
  espelhosDe,
  faturamentoPorMesDoFinanceiro,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type BaseDosEspelhos,
} from "@/lib/data/espelhos-do-job";
import { notasEmitidasDosJobs } from "@/lib/data/faturamento-por-job";
import type {
  EnvioDaAlteracao,
  JobStatus,
  ParametrosDoJobGravados,
  PrevisaoDaAlteracao,
} from "@/lib/types";

interface EnvioLido {
  id: string;
  mes: string | null;
  valor_faturado: number;
  parcelas: Array<{ id: string; ordem: number; data_vencimento: string; valor: number }>;
}

/** Previsão vazia não tem data a acompanhar (a mesma frase do "Editar
 *  orçado"). */
const SEM_DATA_PARA_ACOMPANHAR =
  "Valor novo precisa de data: preencha a previsão de recebimento no Editar registro da aba Abertura do Job antes de mudar os parâmetros.";

type Result = { ok: true; alteracaoId: string } | { ok: false; message: string };

const paraSchema = z.object({
  percentual_honorarios: z.number().min(0, "Honorários não podem ser negativos.").max(100, "Honorários vão até 100%."),
  percentual_imposto: z.number().min(0, "Impostos não podem ser negativos.").lt(100, "Impostos precisam ficar abaixo de 100%."),
  percentual_int_taxes: z.number().min(0, "Int. taxes não podem ser negativas.").lt(100, "Int. taxes precisam ficar abaixo de 100%."),
  int_transaction_costs: z.number().min(0, "O custo de transação não pode ser negativo."),
  moeda_estrangeira: z.string().trim().max(3).nullable(),
  cambio_cotacao: z.number().nullable(),
  cambio_data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data da cotação inválida.")
    .nullable(),
  percentual_veiculo: z.number().min(0).max(100, "A parte do veículo vai até 100%."),
  base_honorarios: z.enum(["negociado", "liquido"]),
});

const payloadSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, "O motivo da alteração precisa de pelo menos 5 caracteres.")
    .max(500, "O motivo da alteração passa de 500 caracteres."),
  para: paraSchema,
});

export type PayloadParametrosDoJob = z.input<typeof payloadSchema>;

const CAMPOS_DO_CAMBIO = ["moeda_estrangeira", "cambio_cotacao", "cambio_data"] as const;

const num = (v: unknown): number => Number(v ?? 0);
const numOuNulo = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function alterarParametrosDoJob(
  jobId: string,
  payload: PayloadParametrosDoJob,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar_orcado_financeiro");
  if (!gate.ok) return gate;

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { motivo } = parsed.data;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  // ---- Tudo que a conta precisa, de uma vez (docs/PERFORMANCE.md) ----
  const [jobRes, atualRes, baseRes, recebimentoRes, impostosRes, enviosRes, notasPorJob] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, status, data_abertura_financeiro, orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
      )
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("vw_parametros_do_job")
      .select(
        "percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data, percentual_veiculo, base_honorarios",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    // Com os meses: no mensal a previsão de recebimento anda mês a mês.
    lerBaseDosEspelhos(supabase, tenantId, jobId),
    supabase
      .from("jobs_previsao_recebimento")
      .select("id, ordem, data_prevista, valor, mes")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      // A mesma ordem do "Editar orçado": a última parcela fecha o centavo.
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
  const job = jobRes.data as {
    id: string;
    status: JobStatus;
    data_abertura_financeiro: string | null;
    orcamento: { categoria: { modelo_planilha: string } | null } | null;
  } | null;
  if (jobRes.error || !job) return { ok: false, message: "Job não encontrado." };
  if (atualRes.error || !atualRes.data) {
    console.error("[parametros-do-job.atual]", atualRes.error?.message);
    return { ok: false, message: "Não foi possível ler os parâmetros do job agora. Tente de novo." };
  }
  if (!baseRes.ok) return { ok: false, message: baseRes.message };
  const base: BaseDosEspelhos = baseRes.base;
  const erroLeitura = recebimentoRes.error ?? impostosRes.error ?? enviosRes.error;
  if (erroLeitura) {
    // Sem saber o estado inteiro (previsões, envio), gravar seria deixar
    // alguma parte para trás: melhor parar.
    console.error("[parametros-do-job.leitura]", erroLeitura.message);
    return { ok: false, message: "Não foi possível ler o job agora. Tente de novo." };
  }

  const naFila = job.status === "aguardando_abertura";
  // A mesma janela do "Editar orçado" (e da função do banco): até o
  // encerramento.
  const aberto =
    !!job.data_abertura_financeiro && (job.status === "aberto" || job.status === "em_producao");
  if (!naFila && !aberto) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.parametros_alterados_financeiro",
        motivo: "job_fora_da_janela",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message:
        "Os parâmetros só são editados pelo financeiro da abertura do job até o encerramento.",
    };
  }

  const a = atualRes.data as Record<string, unknown>;
  const atual: ParametrosDoJobGravados = {
    percentual_honorarios: num(a.percentual_honorarios),
    percentual_imposto: num(a.percentual_imposto),
    percentual_int_taxes: num(a.percentual_int_taxes),
    int_transaction_costs: num(a.int_transaction_costs),
    moeda_estrangeira: (a.moeda_estrangeira as string | null) ?? null,
    cambio_cotacao: numOuNulo(a.cambio_cotacao),
    cambio_compra: numOuNulo(a.cambio_compra),
    cambio_venda: numOuNulo(a.cambio_venda),
    cambio_data: (a.cambio_data as string | null) ?? null,
    percentual_veiculo: num(a.percentual_veiculo ?? 80),
    base_honorarios: (a.base_honorarios as string) ?? "negociado",
  };

  // ---- O retrato novo: só o que o modelo do job tem muda ----
  const modelo = job.orcamento?.categoria?.modelo_planilha ?? "nacional";
  const internacional = modelo === "internacional";
  const midiaOff = modelo === "midia_off";
  const p = parsed.data.para;
  const para: ParametrosDoJobGravados = {
    ...atual,
    percentual_honorarios: p.percentual_honorarios,
    percentual_imposto: p.percentual_imposto,
  };
  if (internacional) {
    para.percentual_int_taxes = p.percentual_int_taxes;
    para.int_transaction_costs = p.int_transaction_costs;
    const moeda = p.moeda_estrangeira ? p.moeda_estrangeira.toUpperCase() : null;
    const cambioMudou =
      moeda !== atual.moeda_estrangeira ||
      p.cambio_cotacao !== atual.cambio_cotacao ||
      p.cambio_data !== atual.cambio_data;
    if (cambioMudou) {
      if (!moeda) return { ok: false, message: "Escolha a moeda do job." };
      if (p.cambio_cotacao === null || !cotacaoValida(p.cambio_cotacao)) {
        return {
          ok: false,
          message: "Informe a cotação do dia, maior que 0,20: compra e venda saem dela (−0,20 e +0,20).",
        };
      }
      // Compra e venda saem da cotação, aqui, como no orçamento.
      para.moeda_estrangeira = moeda;
      para.cambio_cotacao = p.cambio_cotacao;
      para.cambio_compra = compraDaCotacao(p.cambio_cotacao);
      para.cambio_venda = vendaDaCotacao(p.cambio_cotacao);
      para.cambio_data = p.cambio_data;
    }
  }
  if (midiaOff) {
    para.percentual_veiculo = p.percentual_veiculo;
    para.base_honorarios = p.base_honorarios;
  }
  // Fora do internacional a alíquota sai da mesma lista do orçamento.
  if (!internacional && para.percentual_imposto !== atual.percentual_imposto) {
    if (!isAliquotaConhecida(para.percentual_imposto)) {
      return { ok: false, message: "Escolha a alíquota de impostos na lista." };
    }
  }

  const mudou = (Object.keys(para) as Array<keyof ParametrosDoJobGravados>).filter(
    (k) => para[k] !== atual[k],
  );
  if (mudou.length === 0) return { ok: false, message: "Nenhum parâmetro mudou." };
  const soCambio = mudou.every((k) => (CAMPOS_DO_CAMBIO as readonly string[]).includes(k));

  // ---- O envio e a trava da nota (P4 do "Editar orçado") ----
  const envios: EnvioLido[] = ((enviosRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    mes: e.mes ?? null,
    valor_faturado: Number(e.valor_faturado ?? 0),
    parcelas: ((e.parcelas ?? []) as any[])
      .map((x) => ({
        id: x.id as string,
        ordem: Number(x.ordem ?? 0),
        data_vencimento: x.data_vencimento as string,
        valor: Number(x.valor ?? 0),
      }))
      .sort((x, y) => x.ordem - y.ordem),
  }));
  const idsParcelas = envios.flatMap((e) => e.parcelas.map((x) => x.id));
  const notasDasParcelasRes =
    !naFila && !soCambio && idsParcelas.length > 0
      ? await supabase
          .from("faturamento_itens")
          .select("envio_parcela_id, faturamento:faturamentos!inner(status)")
          .eq("tenant_id", tenantId)
          .eq("faturamento.status", "emitido")
          .in("envio_parcela_id", idsParcelas)
      : { data: [], error: null };
  if (notasDasParcelasRes.error) {
    console.error("[parametros-do-job.notas]", notasDasParcelasRes.error.message);
    return { ok: false, message: "Não foi possível conferir as notas emitidas deste job. Tente de novo." };
  }
  // Os parâmetros mexem em todos os meses: no mensal, qualquer mês com nota
  // também trava. O câmbio não muda conta em reais e segue editável.
  if (!naFila && !soCambio) {
    const temNota =
      (notasPorJob.get(jobId)?.length ?? 0) > 0 || (notasDasParcelasRes.data ?? []).length > 0;
    if (temNota) {
      return {
        ok: false,
        message:
          "O job já tem nota emitida (faturamento parcial ou total): honorários, impostos e taxas não mudam mais pelo financeiro.",
      };
    }
  }

  // ---- Os números do financeiro, antes e depois ----
  const planilhaDepois = configDaPlanilha(base.modeloPlanilha, para);
  const baseDepois: BaseDosEspelhos = {
    ...base,
    percentualHonorarios: para.percentual_honorarios,
    percentualImposto: para.percentual_imposto,
    internacional: planilhaDepois.internacional,
    midia: base.midia ? parametrosDaVersao(para) : null,
  };
  const antes = totaisDoFinanceiro(base.itens, base);
  const depois = totaisDoFinanceiro(base.itens, baseDepois);
  const fatAntes = dinheiro(antes.faturamentoPrevisto);
  const fatDepois = dinheiro(depois.faturamentoPrevisto);
  const impostoAntes = dinheiro(antes.faturamento.imposto + antes.faturamento.intTaxes);
  const impostoDepois = dinheiro(depois.faturamento.imposto + depois.faturamento.intTaxes);

  // ---- A previsão de recebimento e o envio acompanham (P3, P4) ----
  // Na fila não há previsão gravada nem envio: as listas vêm vazias e nada
  // anda — quem acompanha é o formulário da abertura.
  const recebimentoAtual = ((recebimentoRes.data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    data_prevista: r.data_prevista as string,
    mes: (r.mes as string | null) ?? null,
    valor: Number(r.valor ?? 0),
  }));
  let recebimentoNovo = recebimentoAtual;
  const enviosNovos = new Map<string, EnvioLido>();

  if (base.mensal) {
    // Cada mês recebe o que ele fatura: todos os meses andam.
    const porMes = (b: BaseDosEspelhos) =>
      new Map(
        (faturamentoPorMesDoFinanceiro(base.itens, b) ?? []).map((m) => [m.mes.slice(0, 7), m.faturamento]),
      );
    const fatMesAntes = porMes(base);
    const fatMesDepois = porMes(baseDepois);
    for (const chave of new Set([...fatMesAntes.keys(), ...fatMesDepois.keys()])) {
      const delta = dinheiro((fatMesDepois.get(chave) ?? 0) - (fatMesAntes.get(chave) ?? 0));
      if (Math.abs(delta) < 0.005) continue;
      const doMes = recebimentoNovo.filter((r) => r.mes?.slice(0, 7) === chave);
      if (!naFila && doMes.length === 0) return { ok: false, message: SEM_DATA_PARA_ACOMPANHAR };
      const novos = new Map(distribuir(doMes, delta).map((r) => [r.id, r]));
      recebimentoNovo = recebimentoNovo.map((r) => novos.get(r.id) ?? r);
      const envio = envios.find((e) => e.mes?.slice(0, 7) === chave);
      if (envio) {
        enviosNovos.set(envio.id, {
          ...envio,
          valor_faturado: dinheiro(envio.valor_faturado + delta),
          parcelas: distribuir(envio.parcelas, delta),
        });
      }
    }
  } else {
    const delta = dinheiro(fatDepois - fatAntes);
    if (!naFila && recebimentoAtual.length === 0 && Math.abs(delta) >= 0.005) {
      return { ok: false, message: SEM_DATA_PARA_ACOMPANHAR };
    }
    recebimentoNovo = distribuir(recebimentoAtual, delta);
    const envio = envios.find((e) => e.mes === null);
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

  // O envio não aceita parcela sem valor: melhor a frase aqui do que o erro
  // de constraint.
  if ([...enviosNovos.values()].some((e) => e.valor_faturado <= 0 || e.parcelas.some((x) => x.valor <= 0))) {
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
    parcelas: e.parcelas.map((x) => ({ data_vencimento: x.data_vencimento, valor: x.valor })),
  });
  const enviosTocados = envios.filter((e) => enviosNovos.has(e.id));

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
        parametros: { de: atual, para },
        itens: [],
        linhas: [],
        envios: [...enviosNovos.values()].map((e) => ({ id: e.id, valor_faturado: e.valor_faturado })),
        parcelas_envio: [...enviosNovos.values()].flatMap((e) =>
          e.parcelas.map((x) => ({ id: x.id, valor: x.valor })),
        ),
        recebimento: recebimentoNovo
          .filter((r, k) => r.valor !== recebimentoAtual[k]?.valor)
          .map((r) => ({ id: r.id, valor: r.valor })),
        impostos: impostosNovos
          .filter((r, k) => r.valor !== impostosAtuais[k]?.valor)
          .map((r) => ({ id: r.id, valor: r.valor })),
        espelhos: espelhosDe(depois),
      },
    },
  );

  if (gravarErr || !alteracaoId) {
    console.error("[parametros-do-job.gravar]", gravarErr?.message);
    const doBanco =
      gravarErr?.code === "P0001" && gravarErr.message ? ` ${gravarErr.message}` : "";
    return {
      ok: false,
      message: `Não foi possível gravar a alteração, e nada foi gravado.${doBanco}`,
    };
  }

  await logAuditEvent({
    acao: "job.parametros_alterados_financeiro",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      alteracao_id: alteracaoId,
      motivo,
      na_fila: naFila,
      campos: mudou,
      de: Object.fromEntries(mudou.map((k) => [k, atual[k]])),
      para: Object.fromEntries(mudou.map((k) => [k, para[k]])),
      valor_job_antes: dinheiro(antes.valorJob),
      valor_job_depois: dinheiro(depois.valorJob),
      faturamento_previsto_antes: fatAntes,
      faturamento_previsto_depois: fatDepois,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
  return { ok: true, alteracaoId: alteracaoId as string };
}
