/**
 * O job como foi ABERTO — decisão 151, entrega 2 (07/10/2026).
 *
 * O planejado do job é o da abertura: a errata não mexe nele, e a linha que
 * sai da conta é cancelada com o planejado intacto (entrega 1). Para o
 * resultado planejado comparar maçã com maçã, a receita do lado planejado
 * também precisa ser a da abertura — e é isso que este arquivo monta.
 *
 * A fonte é a VERSÃO APROVADA, que a errata não altera ("o orçado aprovado
 * da versão não muda: a errata fica registrada sobre ele"). A mesma
 * `calcularTotaisVersao` que gravou `jobs.valor_job_abertura` no envio para
 * abertura, sobre os mesmos itens, devolve o mesmo valor — conferido em
 * 07/10/2026 nos 50 jobs abertos, ao centavo. Quando não bate (um job
 * devolvido que teve o save mexido direto na cópia antes do reenvio, por
 * exemplo), a foto é descartada e a tela fica como era: dividir o valor
 * com uma base errada seria pior do que não dividir.
 */

import {
  calcularTotaisVersao,
  type ItemParaTotais,
  type ParametrosInternacionais,
} from "@/lib/calculos/versao-totais";

/** Um item da versão aprovada, como a foto da abertura precisa dele. */
export interface ItemDaVersaoNaAbertura extends ItemParaTotais {
  id: string;
}

/** Os números do job na abertura — o lado PLANEJADO do resultado. */
export interface FechamentoDaAbertura {
  valorJob: number;
  /** Tudo que sai do valor do job antes de sobrar resultado: imposto e,
   *  no internacional, int. taxes e custos de transação. */
  deducoes: number;
  imposto: number;
  intTaxes: number;
  intTransactionCosts: number;
  honorarios: number;
  /** Base da rentabilidade planejada: o orçado da abertura, sem as linhas
   *  em save (decisão 028 §9). */
  orcadoRentabilidade: number;
}

/**
 * Monta a foto da abertura a partir da versão aprovada. Devolve `null`
 * quando o job ainda não tem abertura gravada ou quando a conta não
 * reproduz o `valor_job_abertura` gravado no envio.
 */
export function fechamentoDaAbertura(
  itensDaVersao: ItemDaVersaoNaAbertura[],
  percentualHonorarios: number,
  percentualImposto: number,
  internacional: ParametrosInternacionais | null,
  valorJobAberturaGravado: number | null,
): FechamentoDaAbertura | null {
  if (valorJobAberturaGravado === null) return null;
  const t = calcularTotaisVersao(
    itensDaVersao,
    percentualHonorarios,
    percentualImposto,
    internacional,
  );
  if (centavos(t.valorJob) !== centavos(valorJobAberturaGravado)) return null;
  const orcadoRentabilidade = itensDaVersao.reduce(
    (s, i) => (i.em_save === true ? s : s + Number(i.total_orcado ?? 0)),
    0,
  );
  return {
    valorJob: t.valorJob,
    deducoes: t.deducoesDoResultado,
    imposto: t.imposto,
    intTaxes: t.intTaxes,
    intTransactionCosts: t.intTransactionCosts,
    honorarios: t.honorarios,
    orcadoRentabilidade,
  };
}

/** O valor do job de hoje é outro que o da abertura? Comparado no
 *  centavo. Errata que não muda o valor do job — linha vermelha, só troca
 *  de tipo, correções que se anulam — não divide nada (regra do Tiago,
 *  07/10/2026). */
export function valorDoJobMudouDesdeAAbertura(
  abertura: Pick<FechamentoDaAbertura, "valorJob"> | null,
  valorJobAtual: number,
): boolean {
  return abertura !== null && centavos(abertura.valorJob) !== centavos(valorJobAtual);
}

/** O orçado de cada linha da planilha do job na abertura, pelo id da linha
 *  da versão. A linha criada por errata não está na versão: 0. */
export function orcadoDaLinhaNaAbertura(
  itemVersaoId: string | null,
  totalPorItemDaVersao: Map<string, number>,
): number {
  if (!itemVersaoId) return 0;
  return totalPorItemDaVersao.get(itemVersaoId) ?? 0;
}

function centavos(v: number): number {
  return Math.round(Number(v) * 100);
}
