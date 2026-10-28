import type {
  AlocacaoVigenteSnapshot,
  ColaboradorAlocacao,
  ColaboradorAlocacaoItem,
  ColaboradorAlocacaoItemRegional,
} from "../types";

export interface MontarSnapshotInput {
  pacote: ColaboradorAlocacao | null;
  itens: (ColaboradorAlocacaoItem & { empresa_nome?: string })[];
  regionais: (ColaboradorAlocacaoItemRegional & { regional_nome: string })[];
}

/**
 * Monta o snapshot hierárquico da alocação vigente.
 * Agrupa itens por alocacao_id e regionais por alocacao_item_id.
 *
 * Função pura — sem I/O.
 *
 * @param input { pacote, itens, regionais } — resultado cru das 3 queries
 * @returns snapshot aninhado (pacote + itens com regionais), ou null se pacote for null
 */
export function montarSnapshot(
  input: MontarSnapshotInput
): AlocacaoVigenteSnapshot | null {
  const { pacote, itens, regionais } = input;

  if (!pacote) {
    return null;
  }

  // Monta mapa de regionais por alocacao_item_id pra acesso O(1)
  const regionaisPorItem = new Map<
    string,
    (ColaboradorAlocacaoItemRegional & { regional_nome: string })[]
  >();

  for (const regional of regionais) {
    if (!regionaisPorItem.has(regional.alocacao_item_id)) {
      regionaisPorItem.set(regional.alocacao_item_id, []);
    }
    regionaisPorItem.get(regional.alocacao_item_id)!.push(regional);
  }

  // Constrói itens aninhados
  const itensAninhados = itens.map((item) => ({
    ...item,
    empresa_nome: item.empresa_nome ?? "",
    regionais: regionaisPorItem.get(item.id) ?? [],
  }));

  return {
    pacote,
    itens: itensAninhados,
  };
}
