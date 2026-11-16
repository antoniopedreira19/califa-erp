/**
 * Valor de cada regional num rateio por percentual.
 *
 * Mesma regra da `vw_fluxo_caixa` (migration 20261115950001, Tiago em
 * 15/11/2026): cada regional leva o seu percentual arredondado ao
 * centavo, e a diferença do arredondamento fica num pedaço só, o de
 * MAIOR PERCENTUAL; no empate, a regional que vem primeiro em ordem
 * alfabética. A soma dos pedaços é o valor rateado.
 *
 * Exemplo real (AV-00026): R$ 4.069,86 em SP 30 / NE 25 / RJ 25 / NO 20
 * → SP 1.220,95 · NE 1.017,47 · RJ 1.017,47 · NO 813,97.
 *
 * A conta é feita em centavos inteiros, com a metade arredondada para
 * longe do zero, como o `numeric` do banco. Assim a tela e o fluxo de
 * caixa mostram o mesmo valor por regional.
 */

export interface ParteDoRateio {
  percentual: number;
  /** Nome da regional, para o desempate. Sem nome, fica por último. */
  nome: string | null | undefined;
}

/** Centavos de `percentual`% de `totalCentavos`, arredondados como o banco. */
function centavosDaParte(totalCentavos: number, percentual: number): number {
  // centavos × centésimos de ponto percentual: inteiro exato.
  const produto = totalCentavos * Math.round(percentual * 100);
  return Math.sign(produto) * Math.floor((Math.abs(produto) + 5000) / 10000);
}

function vemAntes(a: ParteDoRateio, b: ParteDoRateio): boolean {
  if (a.percentual !== b.percentual) return a.percentual > b.percentual;
  if (!a.nome) return false;
  if (!b.nome) return true;
  return a.nome.localeCompare(b.nome, "pt-BR") < 0;
}

/** Valor em R$ de cada parte, na mesma ordem de `partes`. */
export function valoresDoRateio(partes: ParteDoRateio[], valorTotal: number): number[] {
  if (partes.length === 0) return [];
  const totalCentavos = Math.round(valorTotal * 100);
  const centavos = partes.map((p) => centavosDaParte(totalCentavos, p.percentual));

  const somaPercentual = partes.reduce((s, p) => s + p.percentual, 0);
  const alvo = centavosDaParte(totalCentavos, somaPercentual);
  const diferenca = alvo - centavos.reduce((s, c) => s + c, 0);

  let escolhida = 0;
  partes.forEach((p, idx) => {
    if (vemAntes(p, partes[escolhida])) escolhida = idx;
  });
  centavos[escolhida] += diferenca;

  return centavos.map((c) => c / 100);
}
