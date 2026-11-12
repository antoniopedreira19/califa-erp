/**
 * Todas as linhas de uma consulta, sem o corte de 1.000 do PostgREST
 * (decisão 255, 12/11/2026).
 *
 * O PostgREST deste projeto devolve no máximo 1.000 linhas por pedido, e
 * corta em silêncio: sem erro, sem aviso, a lista simplesmente acaba no
 * milésimo item (ver o incidente dos 5.887 itens no HANDOFF_ORCAMENTO, §4).
 * Quem PRECISA da lista inteira — o mapa de fornecedores que dá nome e
 * conta às PPs do financeiro, a tela do cadastro — pede por aqui, página a
 * página.
 *
 * A consulta tem de vir ORDENADA por uma chave única no fim (`.order("id")`
 * depois da ordem de exibição): sem isso, duas páginas podem repetir ou
 * pular a mesma linha. Combo de escolha não usa isto: busca no servidor
 * enquanto a pessoa digita (`buscar_fornecedores`).
 *
 * Uso:
 *   const res = await todasAsLinhas((de, ate) =>
 *     supabase.from("fornecedores").select("id, nome")
 *       .eq("tenant_id", t).order("nome").order("id").range(de, ate));
 */

/** O tamanho da página do PostgREST deste projeto. */
export const LINHAS_POR_PAGINA = 1000;

/** Teto de páginas: 50 mil linhas. Passar disso é sinal de consulta
 *  errada, e a função para em vez de girar sem fim. */
const PAGINAS_NO_MAXIMO = 50;

type Resposta<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function todasAsLinhas<T>(
  pagina: (de: number, ate: number) => Resposta<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const linhas: T[] = [];
  for (let n = 0; n < PAGINAS_NO_MAXIMO; n++) {
    const de = n * LINHAS_POR_PAGINA;
    const { data, error } = await pagina(de, de + LINHAS_POR_PAGINA - 1);
    if (error) return { data: linhas, error };
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length < LINHAS_POR_PAGINA) return { data: linhas, error: null };
  }
  return {
    data: linhas,
    error: { message: `Mais de ${PAGINAS_NO_MAXIMO * LINHAS_POR_PAGINA} linhas: consulta interrompida.` },
  };
}
