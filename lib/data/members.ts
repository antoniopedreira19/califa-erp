import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Lista os membros ativos do tenant (com profile também ativo), ordenados
 * por nome. Retornam o mínimo necessário para popular selects.
 *
 * Feito em 2 queries porque tenant_members.user_id aponta para auth.users,
 * não para public.profiles — PostgREST não infere esse join. Duas queries
 * indexadas por tenant_id/status são baratas o suficiente pro MVP.
 */
export async function listActiveMembers(
  tenantId: string,
): Promise<Pick<Profile, "id" | "nome">[]> {
  const supabase = createClient();

  const { data: memberRows, error: memberErr } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "ativo");

  if (memberErr) {
    console.error("[members.list.members]", memberErr.message);
    return [];
  }

  const userIds = (memberRows ?? []).map((r) => r.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, nome")
    .in("id", userIds)
    .eq("ativo", true)
    .order("nome");

  if (profileErr) {
    console.error("[members.list.profiles]", profileErr.message);
    return [];
  }

  return (profiles ?? []) as Pick<Profile, "id" | "nome">[];
}
