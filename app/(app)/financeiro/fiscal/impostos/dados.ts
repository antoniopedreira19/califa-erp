import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ESQUELETO (entrega 2 do fiscal): o agente de Impostos a Pagar substitui
 * este arquivo inteiro, mantendo os três nomes exportados
 * (`DadosDosImpostos`, `carregarImpostos`, `contarImpostosAPagar`), que a
 * página usa.
 */
export interface DadosDosImpostos {
  tenantId: string;
}

export async function carregarImpostos(supabase: SupabaseClient, tenantId: string): Promise<DadosDosImpostos> {
  void supabase;
  return { tenantId };
}

/** Quantos impostos estão em aberto (o número da aba). */
export async function contarImpostosAPagar(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const { count } = await supabase
    .from("impostos_a_pagar")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "a_pagar");
  return count ?? 0;
}
