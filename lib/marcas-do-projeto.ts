/**
 * Marcas do projeto (decisão 133, 30/09/2026).
 *
 * O projeto aceita mais de uma marca do cliente. As ESCOLHIDAS vivem em
 * `projeto_marcas`; `projetos.produto_id` guarda a marca que o job leva ao
 * financeiro, e é dela que o envio para abertura e os relatórios leem.
 *
 * A regra é uma só, e mora aqui para o formulário e o servidor não
 * divergirem:
 *
 *   - uma marca escolhida  → é ela;
 *   - mais de uma          → a marca geral do cliente (a `padrao`, código
 *     PRD-01), esteja ela entre as escolhidas ou não.
 */
export function marcaDoJob(
  escolhidas: ReadonlyArray<string>,
  marcaGeralId: string | null,
): string | null {
  if (escolhidas.length === 0) return null;
  if (escolhidas.length === 1) return escolhidas[0];
  return marcaGeralId;
}
