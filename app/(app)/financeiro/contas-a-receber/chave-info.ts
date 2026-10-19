/**
 * A chave do botão `i` da fila de faturamento.
 *
 * O envio para faturamento era um por job, e a chave era o `job_id`. No job
 * mensal — Fee e Always On (decisão 078) — há um envio por mês, cada um com
 * a sua PO e a sua instrução de descrição da nota; a chave ganha o mês.
 * A chave só do job continua existindo: é a que a nota já emitida consulta.
 *
 * Módulo sem "use client": a página (server) monta o mapa e a lista e a
 * gaveta (client) leem, e função exportada de módulo client não roda no
 * servidor.
 */
export function chaveInfoDoEnvio(jobId: string, mes: string | null): string {
  return mes ? `${jobId}|${mes}` : jobId;
}

/**
 * A chave do recebimento antes da NF (decisão 130): a nota do envio ou o
 * BV. É a mesma chave da linha da fila — `nota:<id>` junta os vencimentos
 * de uma nota, e o BV é `bv:<id>`. Nula na linha que não aceita o
 * recebimento (parcela de envio anterior às notas).
 */
export function chaveDoRecebidoAntes(
  envioNotaId: string | null,
  bvId: string | null,
): string | null {
  if (envioNotaId) return `nota:${envioNotaId}`;
  if (bvId) return `bv:${bvId}`;
  return null;
}

/**
 * A chave da linha da fila de faturamento: a nota do envio junta os
 * vencimentos dela, e a nota do envio em lote junta as partes dos jobs
 * (decisão 188). A página conta as linhas por ela — o número da aba é o de
 * linhas da fila, não o de parcelas.
 */
export function chaveDaLinhaDaFila(r: {
  lote: { lote_nota_id: string } | null;
  envio_nota_id: string | null;
  envio_parcela_id: string | null;
  origem_tipo: string;
  origem_id: string;
}): string {
  if (r.lote) return `lote:${r.lote.lote_nota_id}`;
  if (r.envio_nota_id) return `nota:${r.envio_nota_id}`;
  return r.envio_parcela_id ?? `${r.origem_tipo}:${r.origem_id}`;
}
