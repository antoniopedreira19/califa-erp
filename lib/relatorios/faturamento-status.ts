/**
 * Status de faturamento — derivado dos valores previsto e realizado do job.
 *
 * Fonte: `vw_job_rentabilidade` já entrega os dois números; a classificação
 * fica em TS porque a fórmula é simples e permite tolerância explícita.
 */

export type StatusFaturamento = "nao_faturado" | "parcial" | "faturado";

/** Ordem de exibição e whitelist para parse de URL. */
export const STATUS_FATURAMENTO: readonly StatusFaturamento[] = [
  "nao_faturado",
  "parcial",
  "faturado",
];

export const LABELS_STATUS_FATURAMENTO: Record<StatusFaturamento, string> = {
  nao_faturado: "Não Faturado",
  parcial: "Parcial",
  faturado: "Faturado",
};

/**
 * Deriva o status a partir dos valores previsto e realizado.
 *
 * Tolerância de R$ 0,01 no limite superior porque o gross-up do imposto
 * pode produzir centavo de sobra ao arredondar (o job fica "Parcial" por
 * causa de R$ 0,01 sem ela).
 */
export function calcularStatusFaturamento(
  faturamentoPrevisto: number,
  faturamentoRealizado: number,
): StatusFaturamento {
  if (faturamentoRealizado <= 0) return "nao_faturado";
  if (faturamentoRealizado >= faturamentoPrevisto - 0.01) return "faturado";
  return "parcial";
}
