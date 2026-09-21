/**
 * A descrição de um item de fatura como a tela mostra (decisão 093).
 *
 * O lançamento na conta-espelho carrega o prefixo "Cartão · " — útil no
 * extrato daquela conta, redundante dentro da fatura, onde tudo é cartão.
 * E o estorno gravado antes de 20/09/2026 saiu "Estorno · Estorno · …" (o
 * gatilho prefixava uma descrição que a tela já tinha prefixado; corrigido
 * na migration 20260920100002). Só apresentação: o dado fica como está.
 * Puro, para a aba Cartão e a conciliação usarem o mesmo.
 */
export function limparDescricaoDaFatura(descricao: string): string {
  let d = descricao;
  if (d.startsWith("Cartão · ")) d = d.slice("Cartão · ".length);
  while (d.startsWith("Estorno · Estorno · ")) d = d.slice("Estorno · ".length);
  return d;
}
