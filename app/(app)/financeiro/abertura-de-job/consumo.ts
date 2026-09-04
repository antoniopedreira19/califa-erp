import type { SupabaseClient } from "@supabase/supabase-js";
import { emCentavos } from "./curva";
import type { CurvaLinha } from "./curva";

/**
 * Quanto de cada previsão do job já foi consumido, e as previsões
 * guardadas.
 *
 * Módulo próprio (e não dentro de `actions.ts`) porque os dois lados
 * precisam do MESMO número: a Server Action, para recusar edição que
 * mexa no que já foi gasto, e a tela do job aberto, para desenhar as
 * linhas com cadeado. Em arquivo `"use server"` toda export vira Server
 * Action — daí morar aqui.
 *
 * O que conta como consumo:
 *
 *   * CUSTO — PPs que não foram canceladas nem rejeitadas, e que já
 *     CHEGARAM ao financeiro: a `gerada` fica de fora (02/09/2026,
 *     decisão 039) — ela ainda pode ser editada ou cancelada sem passar
 *     por ninguém. Mesma conta do card de PPs da página do job
 *     (`pps-card.tsx`): `em_avaliacao`, `aprovada` e `pago` pesam.
 *   * RECEBIMENTO — notas emitidas do job. Nota cancelada não conta, pelo
 *     mesmo motivo que não conta na esteira de faturamento.
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
  const [ppsRes, notasRes] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("valor, status")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    supabase
      .from("faturamentos")
      .select("valor_total")
      .eq("tenant_id", tenantId)
      .eq("origem_tipo", "job")
      .eq("origem_id", jobId)
      .eq("status", "emitido"),
  ]);

  if (ppsRes.error) {
    console.error("[abertura-job.consumo-pps]", ppsRes.error.message);
  }
  if (notasRes.error) {
    console.error("[abertura-job.consumo-notas]", notasRes.error.message);
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

  const recebimento = (
    (notasRes.data ?? []) as { valor_total: number | string }[]
  ).reduce((s, n) => s + Number(n.valor_total ?? 0), 0);

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
): Promise<{ curva: CurvaLinha[]; recebimento: CurvaLinha[] }> {
  const [curvaRes, recebRes] = await Promise.all([
    supabase
      .from("jobs_previsao_custo")
      .select("id, data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("data_prevista", { ascending: true }),
    supabase
      .from("jobs_previsao_recebimento")
      .select("id, data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("data_prevista", { ascending: true }),
  ]);

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
    recebimento: paraLinhas(recebRes.data ?? []),
  };
}
