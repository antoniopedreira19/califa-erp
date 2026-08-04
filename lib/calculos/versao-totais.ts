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

/**
 * Rentabilidade de um bloco: o que sobra do orçado depois de descontar o
 * custo (planejado OU realizado). Percentual sempre sobre o **orçado**, que
 * é a base usada na tela da versão do orçamento — o mesmo rótulo precisa
 * significar a mesma coisa nas duas telas.
 *
 * Retorna `percentual: null` quando não há custo lançado (sem base =
 * travessão, em vez de um "100%" que só diz que ninguém preencheu nada).
 */
export function calcularRentabilidade(
  orcado: number,
  custo: number,
): { rentabilidade: number; percentual: number | null } {
  const rentabilidade = orcado - custo;
  const percentual =
    custo > 0 && orcado > 0 ? (rentabilidade / orcado) * 100 : null;
  return { rentabilidade, percentual };
}

/**
 * Rentabilidade simples: soma dos totais orçados menos soma dos totais
 * planejados. Percentual em relação ao total orçado.
 *
 * Retorna `percentualRentabilidade: null` quando não há planejado (não
 * planejado = mostrar travessão em vez de "100%").
 *
 * Fórmula completa (com honor+imposto) fica pra iteração futura.
 */
export function calcularTotaisPlanejados(
  itens: Array<Pick<VersaoOrcamentoItem, "total_orcado" | "total_planejado">>,
): {
  totalOrcado: number;
  totalPlanejado: number;
  rentabilidade: number;
  percentualRentabilidade: number | null;
} {
  const totalOrcado = itens.reduce(
    (sum, it) => sum + Number(it.total_orcado ?? 0),
    0,
  );
  const totalPlanejado = itens.reduce(
    (sum, it) => sum + Number(it.total_planejado ?? 0),
    0,
  );
  const { rentabilidade, percentual: percentualRentabilidade } =
    calcularRentabilidade(totalOrcado, totalPlanejado);

  return { totalOrcado, totalPlanejado, rentabilidade, percentualRentabilidade };
}

/**
 * Resultado da versão sob a ótica do desembolso esperado pela agência.
 *
 * - Resultado operacional = faturamento − impostos − custo planejado.
 * - Resultado geral = resultado operacional ÷ faturamento (em %).
 *
 * Sem planejado lançado a conta não existe: retorna `null` nos dois campos
 * em vez de um número inflado (faturamento inteiro virando "lucro").
 *
 * Fonte única do card de Totais e do resumo do cabeçalho da versão.
 */
export function calcularResultadoOperacional(
  faturamento: number,
  imposto: number,
  custoPlanejado: number,
): { resultadoOperacional: number | null; resultadoGeral: number | null } {
  if (custoPlanejado <= 0) {
    return { resultadoOperacional: null, resultadoGeral: null };
  }
  const resultadoOperacional = faturamento - imposto - custoPlanejado;
  const resultadoGeral =
    faturamento > 0 ? (resultadoOperacional / faturamento) * 100 : null;
  return { resultadoOperacional, resultadoGeral };
}

/**
 * Soma dos totais realizados por item.
 * Usado pelo card de Totais do job e por subtotal do grupo.
 */
export function calcularTotaisRealizado(
  itens: { total_realizado: number }[],
): { totalRealizado: number } {
  const totalRealizado = itens.reduce(
    (s, i) => s + Number(i.total_realizado ?? 0),
    0,
  );
  return { totalRealizado };
}

/**
 * Variacao Realizado vs Planejado.
 * - variacaoRS: realizado - planejado (positivo = estouro; negativo = economia)
 * - variacaoPct: relativo ao planejado. null quando planejado eh 0 (sem base).
 */
export function calcularVariacao(
  realizado: number,
  planejado: number,
): { variacaoRS: number; variacaoPct: number | null } {
  const variacaoRS = realizado - planejado;
  const variacaoPct = planejado > 0 ? (variacaoRS / planejado) * 100 : null;
  return { variacaoRS, variacaoPct };
}
