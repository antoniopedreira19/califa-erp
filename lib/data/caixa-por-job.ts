import { createClient } from "@/lib/supabase/server";

/**
 * Recebimentos e custos totais de cada job do tenant.
 *
 * O número é o MAIS ATUAL que existe: o que já foi movimentado, mais o
 * que virou documento (PP, conta avulsa, desembolso, título a receber),
 * mais o que ainda é só previsão da abertura. Decisão do Tiago
 * (24/08/2026): "sempre a soma dos 3 pontos do fluxo de caixa —
 * movimentado, previsão e títulos, independente do tempo, sempre
 * priorizando o que foi realizado, o que se tornou título".
 *
 * A soma vem pronta de `vw_fluxo_caixa_job_totais` (migration
 * 20260824000001), que agrega a `vw_fluxo_caixa`. Duas razões para não
 * refazer a conta aqui:
 *
 *   * a view já resolve o ABATIMENTO — previsão coberta por PP ou por
 *     nota sai da classe `previsao` e reaparece em `titulo`/`movimento`,
 *     nunca nas duas. Somar as tabelas de origem no TypeScript contaria
 *     em dobro;
 *   * a lista lê o tenant inteiro. Descer as linhas cruas da
 *     `vw_fluxo_caixa` para somar em memória é o embed pesado que
 *     `docs/PERFORMANCE.md` proíbe — a view devolve uma linha por job.
 *
 * O `realizado` vem separado porque a coluna traz uma segunda linha com
 * quanto do total já aconteceu ("62% recebido"). É o mesmo total,
 * recortado na classe `movimento`.
 */
export interface CaixaDoJob {
  /** Entradas: movimento + título + previsão. */
  recebimentos: number;
  /** A parte das entradas que já é dinheiro na conta. */
  recebimentos_realizado: number;
  /** Saídas: movimento + título + previsão. */
  custos: number;
  /** A parte das saídas que já saiu da conta. */
  custos_realizado: number;
}

/** Job sem nenhuma linha no fluxo de caixa — nem previsão, nem documento. */
export const CAIXA_VAZIO: CaixaDoJob = {
  recebimentos: 0,
  recebimentos_realizado: 0,
  custos: 0,
  custos_realizado: 0,
};

export async function caixaPorJob(
  tenantId: string,
): Promise<Map<string, CaixaDoJob>> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("vw_fluxo_caixa_job_totais")
    .select(
      "job_id, recebimentos_total, recebimentos_realizado, custos_total, custos_realizado",
    )
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[caixa-por-job]", error.message);
    return new Map();
  }

  const mapa = new Map<string, CaixaDoJob>();
  for (const l of (data ?? []) as any[]) {
    mapa.set(l.job_id, {
      recebimentos: Number(l.recebimentos_total ?? 0),
      recebimentos_realizado: Number(l.recebimentos_realizado ?? 0),
      custos: Number(l.custos_total ?? 0),
      custos_realizado: Number(l.custos_realizado ?? 0),
    });
  }
  return mapa;
}
