import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Lista os membros ativos do tenant (com profile também ativo), ordenados
 * por nome. Retornam o mínimo necessário para popular selects.
 *
 * ⚠️ Pela função `membros_ativos_do_tenant` desde 29/09/2026. Até ali eram
 * duas queries, a primeira em `tenant_members` — e a RLS dela só mostra a
 * própria linha para quem não é administrador. Para GP e produtor a lista
 * vinha com UMA pessoa (eles mesmos): a Equipe do projeto não aceitava
 * ninguém novo, e quem já estava nela nem aparecia para sair. A função
 * devolve id e nome dos membros ativos só para quem é membro do tenant,
 * sem abrir o papel de cada um.
 */
export async function listActiveMembers(
  tenantId: string,
): Promise<Pick<Profile, "id" | "nome">[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("membros_ativos_do_tenant", {
    p_tenant_id: tenantId,
  });

  if (error) {
    console.error("[members.list]", error.message);
    return [];
  }

  return (data ?? []) as Pick<Profile, "id" | "nome">[];
}
