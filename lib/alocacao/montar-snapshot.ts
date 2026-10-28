import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AlocacaoVigenteSnapshot,
  ColaboradorAlocacao,
  ColaboradorAlocacaoItem,
  ColaboradorAlocacaoItemRegional,
} from "../types";

/**
 * Busca a alocação vigente de um colaborador em 3 queries paralelas e
 * monta o snapshot hierárquico. Retorna null se não houver pacote vigente.
 *
 * Usado por `perfil/page.tsx` e `rh/colaboradores/[id]/page.tsx`.
 */
export async function buscarAlocacaoVigente(
  supabase: SupabaseClient,
  colaboradorId: string,
  tenantId: string,
): Promise<AlocacaoVigenteSnapshot | null> {
  // 1. Pacote vigente (data_fim IS NULL)
  const { data: pacoteData, error: pacoteError } = await supabase
    .from("colaboradores_alocacoes")
    .select("*")
    .eq("colaborador_id", colaboradorId)
    .eq("tenant_id", tenantId)
    .is("data_fim", null)
    .maybeSingle();

  if (pacoteError) {
    console.error("[alocacao.buscar.pacote]", pacoteError.message);
    return null;
  }

  if (!pacoteData) return null;

  const pacote = pacoteData as ColaboradorAlocacao;

  // 2. Itens com nome da empresa (filtra pelo pacote vigente).
  //    percentual_empresa vem como string do Supabase (tipo numeric), convertemos abaixo.
  const { data: itensData, error: itensError } = await supabase
    .from("colaboradores_alocacoes_itens")
    .select("*, empresa:empresas(nome_fantasia)")
    .eq("alocacao_id", pacote.id)
    .eq("tenant_id", tenantId);

  if (itensError) {
    console.error("[alocacao.buscar.itens]", itensError.message);
    return null;
  }

  const itensRaw = (itensData ?? []) as Array<
    ColaboradorAlocacaoItem & { empresa: { nome_fantasia: string } | null }
  >;

  // 3. Regionais filtradas pelos itens deste pacote (via IN nos item IDs).
  const itemIds = itensRaw.map((i) => i.id);
  const { data: regionaisData, error: regionaisError } =
    itemIds.length > 0
      ? await supabase
          .from("colaboradores_alocacoes_itens_regionais")
          .select("*, regional:regionais(nome)")
          .in("alocacao_item_id", itemIds)
          .eq("tenant_id", tenantId)
      : { data: [], error: null };

  if (regionaisError) {
    console.error("[alocacao.buscar.regionais]", regionaisError.message);
    return null;
  }

  const regionaisRaw = (regionaisData ?? []) as Array<
    ColaboradorAlocacaoItemRegional & {
      regional: { nome: string } | null;
    }
  >;

  // Normaliza itens com empresa_nome e percentual_empresa como number
  const itens = itensRaw.map((item) => ({
    ...item,
    percentual_empresa: Number(item.percentual_empresa),
    empresa_nome: item.empresa?.nome_fantasia ?? "",
  }));

  // Normaliza regionais com regional_nome e percentual_regional como number
  const regionais = regionaisRaw.map((r) => ({
    ...r,
    percentual_regional: Number(r.percentual_regional),
    regional_nome: r.regional?.nome ?? "",
  }));

  return montarSnapshot({ pacote, itens, regionais });
}

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
