/**
 * Alíquotas de imposto do orçamento.
 *
 * Desde 13/08/2026 o percentual não é mais digitado à mão: são estas as
 * alíquotas praticadas, e as telas oferecem só elas — parâmetros do rascunho,
 * nova versão e edição da versão.
 *
 * Versões antigas gravadas com outro percentual (0, 19,54, 20) não casam com
 * nenhuma opção: nelas o seletor abre vazio, em vez de exibir um valor que a
 * lista não tem.
 *
 * Escolher NÃO é obrigatório para criar ou editar a versão — em branco, criar
 * grava o default 0 e editar preserva o que estava lá. A exigência vale só na
 * aprovação, que é quando os valores travam e viram job: ver
 * `bloqueioAprovacaoVersao` em lib/validations/versoes.ts.
 *
 * Os seis decimais de 24,269914 só cabem porque a coluna virou numeric(10,6)
 * na migration 20260813000002_imposto_seis_casas.sql. Antes dela o banco
 * arredondava para 24,270.
 */
export const ALIQUOTAS_IMPOSTO = [19.53, 24.269914] as const;

/**
 * Alíquota que já vem escolhida quando um orçamento NOVO nasce
 * (03/09/2026). É a praticada na maioria dos jobs; a de 24,269914 é a
 * exceção, e quem precisa dela troca no seletor.
 *
 * Vale só para orçamento novo — versão nova de orçamento existente
 * continua sem palpite, porque ali o parâmetro é decisão da versão. Ver
 * `criarVersaoInicial` (formulário) e `PARAMETROS_PADRAO` (editores
 * multi e agregado).
 */
export const ALIQUOTA_IMPOSTO_PADRAO: number = ALIQUOTAS_IMPOSTO[0];

/** Valor do <SelectItem>. Number(...) reverte sem perda. */
export function aliquotaParaValor(aliquota: number): string {
  return String(aliquota);
}

/** Rótulo em pt-BR, sem zeros à direita: 19,53 / 24,269914. */
export function formatarAliquota(aliquota: number): string {
  return String(aliquota).replace(".", ",");
}

/**
 * O percentual gravado casa com alguma alíquota da lista?
 *
 * Compara com tolerância porque o valor volta do Postgres como numeric e passa
 * por Number() no caminho — igualdade exata de float é frágil demais para
 * decidir se o seletor abre preenchido ou vazio.
 */
export function isAliquotaConhecida(percentual: number): boolean {
  return ALIQUOTAS_IMPOSTO.some((a) => Math.abs(a - percentual) < 1e-9);
}

/** Valor inicial do seletor: a alíquota gravada, ou vazio se for legada. */
export function valorInicialAliquota(percentual: number): string {
  return isAliquotaConhecida(percentual) ? aliquotaParaValor(percentual) : "";
}
