/**
 * Qual versão "vale" para um orçamento: a aprovada e, sem aprovada, a
 * mais recente ainda no jogo.
 *
 * É a regra do "Valor do Job" da página do projeto, da versão vigente da
 * visão agregada, da aba padrão da tela do orçamento (decisão 023) e da
 * exportação e importação do projeto (decisão 041). Quem receber a lista
 * já sem as canceladas obtém exatamente a mesma escolha das telas.
 */
export function escolherVersaoVigente<
  T extends { id: string; numero_versao: number; created_at?: string },
>(versoes: T[], versaoAprovadaId: string | null | undefined): T | null {
  if (versoes.length === 0) return null;
  const aprovada = versaoAprovadaId
    ? versoes.find((v) => v.id === versaoAprovadaId)
    : undefined;
  if (aprovada) return aprovada;
  return [...versoes].sort(
    (a, b) =>
      b.numero_versao - a.numero_versao ||
      (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  )[0];
}
