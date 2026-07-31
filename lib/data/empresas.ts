import { createClient } from "@/lib/supabase/server";
import type { Empresa } from "@/lib/types";

/**
 * Lista empresas ativas do tenant, com a principal primeiro.
 * Usada em selects (novo projeto), badges (listas) e filtros.
 * SELECT direto — nada de embed pesado; a página compõe com um `Map<id, empresa>`.
 */
export async function listEmpresasAtivas(
  tenantId: string,
): Promise<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "principal">[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia, principal")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("principal", { ascending: false })
    .order("razao_social", { ascending: true });

  if (error) {
    console.error("[empresas.listAtivas]", error.message);
    return [];
  }
  return (data ?? []) as Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "principal">[];
}

/**
 * Retorna a empresa marcada como principal do tenant, ou null se não houver.
 * Usado como default do form de projeto.
 */
export async function getEmpresaPrincipal(
  tenantId: string,
): Promise<Pick<Empresa, "id" | "razao_social" | "nome_fantasia"> | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia")
    .eq("tenant_id", tenantId)
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (error) {
    console.error("[empresas.getPrincipal]", error.message);
    return null;
  }
  return data;
}
