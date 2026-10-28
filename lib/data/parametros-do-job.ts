/**
 * Os parâmetros que valem para o job (decisão 224).
 *
 * Honorários, impostos, a cadeia do internacional, o câmbio e a base da
 * Mídia Off nascem na versão aprovada. Quando o financeiro os altera na
 * abertura (ou o câmbio depois dela), o retrato inteiro passa a morar em
 * `jobs_parametros`, e a versão aprovada continua sendo o que o cliente
 * aprovou. Sem linha em `jobs_parametros`, vale a versão.
 *
 * Toda leitura de job que usa esses números faz o mesmo: embute
 * `SELECT_PARAMETROS_DO_JOB` ao lado da versão (`jobs` → `jobs_parametros`
 * é 1:1, então o embed vem como objeto ou `null`) e passa a versão por
 * `comParametrosDoJob`. No banco, a mesma regra é a `vw_parametros_do_job`.
 */

import type { JobAlteracaoFinanceiroComItens, ParametrosDoJobGravados } from "@/lib/types";

/** O embed, para o `select` de `jobs`. */
export const SELECT_PARAMETROS_DO_JOB =
  "parametros:jobs_parametros(percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data, percentual_veiculo, base_honorarios)";

/** Uma linha de `jobs_parametros`, como o embed a devolve. */
export type ParametrosGravadosDoJob = ParametrosDoJobGravados;

/** Os parâmetros do job no formato de `jobs_parametros`, a partir da versão
 *  já passada por `comParametrosDoJob` (o que a tela recebe). */
export function parametrosGravadosDe(versao: Record<string, any>): ParametrosDoJobGravados {
  const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    percentual_honorarios: Number(versao.percentual_honorarios ?? 0),
    percentual_imposto: Number(versao.percentual_imposto ?? 0),
    percentual_int_taxes: Number(versao.percentual_int_taxes ?? 0),
    int_transaction_costs: Number(versao.int_transaction_costs ?? 0),
    moeda_estrangeira: (versao.moeda_estrangeira as string | null) ?? null,
    cambio_cotacao: numOuNulo(versao.cambio_cotacao),
    cambio_compra: numOuNulo(versao.cambio_compra),
    cambio_venda: numOuNulo(versao.cambio_venda),
    cambio_data: (versao.cambio_data as string | null) ?? null,
    percentual_veiculo: Number(versao.percentual_veiculo ?? 80),
    base_honorarios: versao.base_honorarios === "liquido" ? "liquido" : "negociado",
  };
}

/** As alterações do financeiro que mexeram nos parâmetros, mais antigas
 *  primeiro — o selo "Alterado na abertura" da linha de parâmetros. */
export function alteracoesDosParametros(alteracoes: JobAlteracaoFinanceiroComItens[]): Array<{
  id: string;
  created_at: string;
  autor_nome: string | null;
  motivo: string;
  parametros: { de: ParametrosDoJobGravados; para: ParametrosDoJobGravados };
}> {
  return alteracoes
    .filter((a) => a.parametros !== null)
    .map((a) => ({
      id: a.id,
      created_at: a.created_at,
      autor_nome: a.autor_nome,
      motivo: a.motivo,
      parametros: a.parametros as { de: ParametrosDoJobGravados; para: ParametrosDoJobGravados },
    }))
    .sort((x, y) => x.created_at.localeCompare(y.created_at));
}

/** O embed pode vir como objeto (1:1) ou, em select mal tipado, como lista. */
export function parametrosDoEmbed(
  embed: ParametrosGravadosDoJob | ParametrosGravadosDoJob[] | null | undefined,
): ParametrosGravadosDoJob | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/**
 * A versão do job com os parâmetros do job por cima. Só os campos que a
 * versão lida já tinha são trocados: quem leu `percentual_honorarios,
 * percentual_imposto` continua recebendo só os dois.
 */
export function comParametrosDoJob<T extends Record<string, any>>(
  versao: T,
  embed: ParametrosGravadosDoJob | ParametrosGravadosDoJob[] | null | undefined,
): T;
export function comParametrosDoJob<T extends Record<string, any>>(
  versao: T | null | undefined,
  embed: ParametrosGravadosDoJob | ParametrosGravadosDoJob[] | null | undefined,
): T | null;
export function comParametrosDoJob<T extends Record<string, any>>(
  versao: T | null | undefined,
  embed: ParametrosGravadosDoJob | ParametrosGravadosDoJob[] | null | undefined,
): T | null {
  if (!versao) return null;
  const p = parametrosDoEmbed(embed);
  if (!p) return versao;
  const saida: Record<string, any> = { ...versao };
  for (const chave of Object.keys(p) as Array<keyof ParametrosGravadosDoJob>) {
    if (chave in saida) saida[chave] = p[chave];
  }
  return saida as T;
}
