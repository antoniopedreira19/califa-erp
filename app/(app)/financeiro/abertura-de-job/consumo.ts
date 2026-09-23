import type { SupabaseClient } from "@supabase/supabase-js";
import { emCentavos } from "./curva";
import type { CurvaLinha, RecebimentoLinha } from "./curva";
import type { JobCompetencia } from "@/lib/types";
import { notasEmitidasDosJobs } from "@/lib/data/faturamento-por-job";

/**
 * Quanto de cada previsão do job já foi consumido, e as previsões
 * guardadas.
 *
 * Desde a decisão 061 o consumo não trava mais nada: a edição do registro
 * (`editarRegistroDaAbertura`) só o grava na auditoria, em
 * `consumido_na_edicao`, como retrato do que já tinha virado PP e nota na
 * hora da edição. Módulo próprio (e não dentro de `actions.ts`) porque em
 * arquivo `"use server"` toda export vira Server Action.
 *
 * O que conta como consumo:
 *
 *   * CUSTO — PPs que não foram canceladas nem rejeitadas, e que já
 *     CHEGARAM ao financeiro: a `gerada` fica de fora (02/09/2026,
 *     decisão 039) — ela ainda pode ser editada ou cancelada sem passar
 *     por ninguém. Mesma conta do card de PPs da página do job
 *     (`pps-card.tsx`): `em_avaliacao`, `aprovada` e `pago` pesam.
 *   * RECEBIMENTO — a PARTE do job nas notas emitidas, lida pelos itens
 *     (decisão 075, nota de 15/09/2026), a mesma da coluna Faturamento da
 *     esteira. Até então somava o total das notas cujo cabeçalho apontava o
 *     job, e a nota com mais de um item (NF agrupada, save, duas parcelas)
 *     ficava de fora. Nota cancelada não conta.
 */
export interface ConsumoDasPrevisoes {
  custo: number;
  recebimento: number;
}

export async function consumoDasPrevisoes(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<ConsumoDasPrevisoes> {
  const [ppsRes, notasPorJob] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("valor, status")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    notasEmitidasDosJobs(tenantId, [jobId]),
  ]);

  if (ppsRes.error) {
    console.error("[abertura-job.consumo-pps]", ppsRes.error.message);
  }

  const custo = (
    (ppsRes.data ?? []) as { valor: number | string; status: string }[]
  )
    .filter(
      (p) =>
        p.status !== "cancelada" &&
        p.status !== "rejeitada" &&
        p.status !== "gerada",
    )
    .reduce((s, p) => s + Number(p.valor ?? 0), 0);

  const recebimento = (notasPorJob.get(jobId) ?? []).reduce(
    (s, n) => s + n.parte_do_job,
    0,
  );

  return { custo: emCentavos(custo), recebimento: emCentavos(recebimento) };
}

/**
 * As duas previsões como estão gravadas, no formato que o formulário de
 * abertura usa. Ordenadas por data: é a ordem em que o consumo anda, e
 * portanto a ordem que decide o que congela.
 */
export async function previsoesGravadas(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<{
  curva: CurvaLinha[];
  recebimento: RecebimentoLinha[];
  impostos: CurvaLinha[];
}> {
  const [curvaRes, recebRes, impRes] = await Promise.all([
    supabase
      .from("jobs_previsao_custo")
      .select("id, data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("data_prevista", { ascending: true }),
    supabase
      .from("jobs_previsao_recebimento")
      .select("id, data_prevista, valor, mes")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("data_prevista", { ascending: true }),
    // Cronograma de impostos (decisão 100): na ordem em que foi gravado —
    // é a ordem I01, I02… da tela.
    supabase
      .from("jobs_previsao_impostos")
      .select("id, data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("ordem", { ascending: true }),
  ]);
  if (impRes.error) {
    console.error("[abertura-job.previsao-impostos]", impRes.error.message);
  }

  if (curvaRes.error) {
    console.error("[abertura-job.previsao-custo]", curvaRes.error.message);
  }
  if (recebRes.error) {
    console.error("[abertura-job.previsao-receb]", recebRes.error.message);
  }

  const paraLinhas = (linhas: any[]): CurvaLinha[] =>
    linhas.map((l) => ({
      id: l.id as string,
      data: l.data_prevista as string,
      valor: Number(l.valor ?? 0),
    }));

  return {
    curva: paraLinhas(curvaRes.data ?? []),
    impostos: paraLinhas(impRes.data ?? []),
    // O mês de referência (job mensal, decisão 078) segue junto: é por ele
    // que o formulário casa cada linha com o mês.
    recebimento: ((recebRes.data ?? []) as any[]).map((l) => ({
      id: l.id as string,
      data: l.data_prevista as string,
      valor: Number(l.valor ?? 0),
      mes: (l.mes as string | null) ?? null,
    })),
  };
}

/**
 * O rateio de competência gravado para o job (`jobs_competencias`,
 * decisão 055), em ordem de ano e trimestre. Vazio em job que ainda não
 * passou pela abertura — a página cai na competência sugerida.
 */
export async function competenciasGravadas(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<JobCompetencia[]> {
  const { data, error } = await supabase
    .from("jobs_competencias")
    .select("trimestre, ano, percentual")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .order("ano", { ascending: true })
    .order("trimestre", { ascending: true });

  if (error) {
    console.error("[abertura-job.competencias]", error.message);
    return [];
  }

  return ((data ?? []) as any[]).map((c) => ({
    trimestre: Number(c.trimestre),
    ano: Number(c.ano),
    percentual: Number(c.percentual ?? 0),
  }));
}
