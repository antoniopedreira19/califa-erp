/**
 * Reconcilia o `periodoId` selecionado quando a lista de períodos
 * disponíveis muda (ex: usuário desmarca "modo retroativo" no RH e o
 * período que estava selecionado some da lista). Retorna o novo
 * `periodoId` a usar.
 *
 * - Se o atual continua na lista: mantém.
 * - Se sumiu (ou nunca existiu): pega o primeiro disponível, ou "" se vazio.
 */
export function reconciliarPeriodoSelecionado(
  periodosDisponiveis: Array<{ id: string }>,
  periodoAtualId: string,
): string {
  if (periodoAtualId && periodosDisponiveis.some((p) => p.id === periodoAtualId)) {
    return periodoAtualId;
  }
  return periodosDisponiveis[0]?.id ?? "";
}
