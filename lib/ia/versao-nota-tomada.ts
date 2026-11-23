/**
 * A versão do esquema da leitura ampliada da NF tomada (decisão 271). A
 * nota lida com outra versão volta a ser oferecida para leitura e os dados
 * dela não aparecem como lidos.
 *
 * - v1 (23/11/2026): gravava como "CNAE" o código de tributação do serviço
 *   (item da LC 116, ex. 17.06.01) — 30 notas da produção.
 * - v2 (23/11/2026): o código do serviço em campo próprio; o CNAE só no
 *   formato de CNAE.
 *
 * Sem dependências: a tela (cliente) também lê.
 */
export const ESQUEMA_LEITURA_NOTA_TOMADA = "nota-tomada-v2";

/** A leitura gravada é da versão atual do esquema? */
export function leituraEAtual(modelo: string | null | undefined): boolean {
  return !!modelo && modelo.endsWith(`|${ESQUEMA_LEITURA_NOTA_TOMADA}`);
}
