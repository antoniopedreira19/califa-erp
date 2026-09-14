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
