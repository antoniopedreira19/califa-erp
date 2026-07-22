import type { TipoCusto, VersaoOrcamentoItem } from "@/lib/types";

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

export interface VersaoTotais {
  /** Soma dos totais por tipo (chave: A/B/C/D). */
  subtotaisPorTipo: Record<TipoCusto, number>;
  /** Soma geral de todos os itens (A+B+C+D). */
  subtotalGeral: number;
  /** Base sobre a qual incidem honorários (A + B + D). Tipo C fica fora. */
  baseHonorarios: number;
  /** Base sobre a qual incide o imposto (B + C + Honorários). */
  baseImposto: number;
  /** Honorários calculados: baseHonorarios × %honor. */
  honorarios: number;
  /** Imposto calculado em regime gross-up:
   *  baseImposto × taxa / (1 − taxa), com taxa = %imp/100. */
  imposto: number;
  /** Faturamento previsto: subtotalGeral + honorários + imposto. */
  faturamento: number;
}

/**
 * Regra de cálculo da versão do orçamento (valida com o time comercial;
 * revisões futuras podem alterar).
 *
 * - Honorários incidem sobre (A + B + D). Tipo C fica de fora
 *   (contrato específico do Bruno: sem honorários da agência).
 * - Imposto usa a base (B + C + Honorários), no regime gross-up: a
 *   agência precisa faturar bruto o suficiente para que, depois do
 *   imposto ser descontado, sobre exatamente a base líquida. Fórmula:
 *      imposto = base × taxa / (1 − taxa)
 *   Se %imp = 19,53, então taxa = 0,1953 e o multiplicador é ≈ 0,2427.
 * - Faturamento é a soma dos custos + honorários + imposto.
 */
export function calcularTotaisVersao(
  itens: VersaoOrcamentoItem[],
  percentualHonorarios: number,
  percentualImposto: number,
): VersaoTotais {
  const subtotaisPorTipo: Record<TipoCusto, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of itens) {
    subtotaisPorTipo[it.tipo_custo] =
      (subtotaisPorTipo[it.tipo_custo] ?? 0) + Number(it.total_orcado ?? 0);
  }

  const subtotalGeral = TIPOS.reduce((s, t) => s + subtotaisPorTipo[t], 0);

  const baseHonorarios =
    subtotaisPorTipo.A + subtotaisPorTipo.B + subtotaisPorTipo.D;
  const honorarios = baseHonorarios * (percentualHonorarios / 100);

  const baseImposto = subtotaisPorTipo.B + subtotaisPorTipo.C + honorarios;
  const taxa = Math.max(0, Math.min(0.9999, percentualImposto / 100));
  const imposto = taxa > 0 ? (baseImposto * taxa) / (1 - taxa) : 0;

  const faturamento = subtotalGeral + honorarios + imposto;

  return {
    subtotaisPorTipo,
    subtotalGeral,
    baseHonorarios,
    baseImposto,
    honorarios,
    imposto,
    faturamento,
  };
}
