/**
 * O subtipo único do plano de contas (decisão 251, 10/11/2026).
 *
 * A PP nasce só com o tipo, 02 · Custo Operacional (decisão 068), e o
 * subtipo ficava para a baixa. Mas o tipo 02 tem um único subtipo ativo,
 * "Geral (provisório)": a "escolha" na baixa tinha uma opção só, e a
 * conciliação marcava toda PP como "Sem centro de custo", sem baixa de um
 * clique nem lote.
 *
 * A regra: quando o título tem o tipo e não tem o subtipo, e o tipo tem
 * UM subtipo ativo, o centro de custo está completo com esse subtipo.
 * Nada se grava no título: no dia em que o tipo ganhar um segundo subtipo
 * ativo, a regra deixa de valer sozinha e a baixa volta a pedir a escolha.
 *
 * Função pura, sem banco: quem chama passa os subtipos ativos do tenant.
 */

export interface SubtipoDoPlano {
  id: string;
  tipo_id: string;
  ativo: boolean;
}

/** O id do subtipo de cada tipo que tem exatamente um subtipo ativo. */
export function subtipoUnicoPorTipo(subtipos: readonly SubtipoDoPlano[]): Map<string, string> {
  const ativos = new Map<string, string[]>();
  for (const s of subtipos) {
    if (!s.ativo) continue;
    const lista = ativos.get(s.tipo_id);
    if (lista) lista.push(s.id);
    else ativos.set(s.tipo_id, [s.id]);
  }
  const unico = new Map<string, string>();
  for (const [tipoId, ids] of ativos) if (ids.length === 1) unico.set(tipoId, ids[0]);
  return unico;
}

/** O subtipo do título: o dele, ou o único ativo do tipo, ou nenhum. */
export function subtipoDoTitulo(
  tipoId: string | null,
  subtipoId: string | null,
  unico: ReadonlyMap<string, string>,
): string | null {
  if (subtipoId) return subtipoId;
  if (!tipoId) return null;
  return unico.get(tipoId) ?? null;
}
