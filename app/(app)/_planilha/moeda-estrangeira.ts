/** A coluna e os valores em moeda estrangeira da planilha internacional.
 *
 *  Fonte única da conversão (decisão 072). A planilha e o card de Totais
 *  mostram o mesmo número de jeitos diferentes — um sem prefixo, o outro
 *  com —, e é para essa diferença não virar duas contas que as duas
 *  formatações moram aqui.
 *
 *  Sem "use client" de propósito: a tabela de itens é client, o card de
 *  Totais é server, e os dois importam daqui.
 */

export interface MoedaEstrangeira {
  /** Código ISO que o cabeçalho da coluna exibe: "USD", "GBP". */
  codigo: string;
  /**
   * Taxa de **compra** — a que converte.
   *
   * É `versoes_orcamento.cambio_compra` — e **não** `taxa_cambio`, que
   * segue valendo 1 porque os valores da planilha continuam em BRL. A
   * cotação do dia e a taxa de venda também ficam gravadas na versão, mas
   * como registro de conferência: quem divide é esta. É o que a planilha
   * modelo faz em `B15` (`= cotação − 0,20`).
   */
  compra: number;
}

/** Uma taxa de câmbio como o ERP a escreve: 4 casas, pt-BR. "4,9700".
 *
 *  Quatro casas porque é a precisão de `versoes_orcamento.cambio_compra`
 *  (`numeric(12,4)`) — mostrar menos esconderia diferença que a conta usa. */
export function formatarTaxa(n: number): string {
  return Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** A conta, crua. `null` quando não há taxa utilizável — taxa zerada não
 *  pode virar `Infinity` na tela. */
export function converter(
  totalBrl: number,
  moeda: MoedaEstrangeira | null,
): number | null {
  if (!moeda || !(moeda.compra > 0) || !Number.isFinite(totalBrl)) return null;
  return totalBrl / moeda.compra;
}

const FORMATO = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

/**
 * Como a **planilha** mostra: número puro, sem prefixo.
 *
 * O cabeçalho da coluna já diz qual é a moeda, e o prefixo custaria ~34px
 * de uma coluna que já é a mais apertada do bloco ORÇADO.
 */
export function naMoedaEstrangeira(
  totalBrl: number,
  moeda: MoedaEstrangeira | null,
): string {
  const v = converter(totalBrl, moeda);
  return v === null ? "—" : v.toLocaleString("pt-BR", FORMATO);
}

/**
 * Como a **cadeia de faturamento** mostra: com o código na frente.
 *
 * Ali a coluna da moeda fica lado a lado com a de BRL, e sem o prefixo as
 * duas viram dois números sem dono.
 */
export function emMoedaEstrangeira(
  totalBrl: number,
  moeda: MoedaEstrangeira | null,
): string {
  const v = converter(totalBrl, moeda);
  return v === null
    ? "—"
    : `${moeda?.codigo ?? ""} ${v.toLocaleString("pt-BR", FORMATO)}`.trim();
}
