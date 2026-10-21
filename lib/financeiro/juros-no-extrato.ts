/**
 * A baixa com juros e multa no Extrato (decisão 196): UMA linha, com o que
 * saiu da conta — o principal mais os juros —, e a nota "inclui R$ X de
 * juros". No banco são dois lançamentos (a baixa, que quita o título, e os
 * juros, em 11 · Despesa com Juros, ligados por `juros_de_lancamento_id`);
 * no extrato do banco, um débito só. Como a guia de imposto (decisão 141).
 *
 * O saldo e os totais não mudam: a soma é a mesma. Os juros cuja baixa não
 * está na lista (não acontece: os dois têm a mesma conta e a mesma data)
 * ficam na linha deles.
 */

export interface LinhaComJuros {
  id: string;
  valor: number;
  origem: string;
  juros_de_lancamento_id: string | null;
}

export interface ExtratoComJuros<L> {
  linhas: L[];
  /** Linha da baixa → os juros que ela inclui. */
  juros: Record<string, number>;
  /** Lançamento de juros → a linha que o mostra (para o `&highlight=`). */
  linhaDoLancamento: Map<string, string>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function juntarJurosNaBaixa<L extends LinhaComJuros>(linhas: L[]): ExtratoComJuros<L> {
  const ids = new Set(linhas.map((l) => l.id));
  const jurosDaBaixa = new Map<string, number>();
  const linhaDoLancamento = new Map<string, string>();
  for (const l of linhas) {
    if (l.origem !== "juros_baixa" || !l.juros_de_lancamento_id || !ids.has(l.juros_de_lancamento_id)) continue;
    jurosDaBaixa.set(l.juros_de_lancamento_id, r2((jurosDaBaixa.get(l.juros_de_lancamento_id) ?? 0) + l.valor));
    linhaDoLancamento.set(l.id, l.juros_de_lancamento_id);
  }
  const saida: L[] = [];
  for (const l of linhas) {
    if (linhaDoLancamento.has(l.id)) continue;
    const juros = jurosDaBaixa.get(l.id);
    saida.push(juros ? { ...l, valor: r2(l.valor + juros) } : l);
  }
  return { linhas: saida, juros: Object.fromEntries(jurosDaBaixa), linhaDoLancamento };
}
