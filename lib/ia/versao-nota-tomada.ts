/**
 * A versão do esquema da leitura ampliada da NF tomada (decisão 271). A
 * nota lida com outra versão volta a ser oferecida para leitura e os dados
 * dela não aparecem como lidos.
 *
 * - v1 (23/11/2026): gravava como "CNAE" o código de tributação do serviço
 *   (item da LC 116, ex. 17.06.01) — 30 notas da produção.
 * - v2 (23/11/2026): o código do serviço em campo próprio; o CNAE só no
 *   formato de CNAE.
 * - v3 (23/11/2026): a emissão entra na leitura; o CNPJ lido só recusa o
 *   arquivo se for válido (a v2 recusou 8 notas por um dígito lido errado);
 *   o que o PDF traz (número, CNPJ, emissão, valor) e o que diverge do
 *   registro ficam gravados na nota, lida ou não.
 * - v4 (23/11/2026): o texto do PDF, quando existe, entra como segunda
 *   leitura (`texto-da-nf.ts`); discordando da imagem, vale o texto.
 * - v5 (23/11/2026): o texto lido também pela chave de acesso (CNPJ e
 *   número, com o dígito verificador); a v4 errava o número da NFS-e de São
 *   Paulo (pegava o do RPS), o total da DANFE (pegava o frete) e às vezes
 *   lia o CNPJ do tomador como emitente.
 *
 * Sem dependências: a tela (cliente) também lê.
 */
export const ESQUEMA_LEITURA_NOTA_TOMADA = "nota-tomada-v5";

/**
 * O esquema da leitura por IMAGEM (a chave do cache das leituras). A v4 e a
 * v5 só mudaram a leitura pelo texto do PDF: a leitura por imagem é a da v3,
 * e a releitura usa o cache, sem custo.
 */
export const ESQUEMA_DA_LEITURA_POR_IMAGEM = "nota-tomada-v3";

/** A leitura gravada é da versão atual do esquema? */
export function leituraEAtual(modelo: string | null | undefined): boolean {
  return !!modelo && modelo.endsWith(`|${ESQUEMA_LEITURA_NOTA_TOMADA}`);
}
