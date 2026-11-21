import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolve a flag "tem liderados" a partir do resultado bruto da query.
 *  Função pura — a parte testável do `temLiderados` fica aqui, isolada
 *  do I/O. */
export function resolveFlagTemLiderados(
  data: { id: string }[] | null,
): boolean {
  return Array.isArray(data) && data.length > 0;
}

/** True se o profile (pelo `profileId`) é líder direto de pelo menos 1
 *  colaborador do tenant. Usado no layout pra decidir se o item "Equipe"
 *  aparece na sidebar.
 *
 *  Índice parcial `idx_colaboradores_lider_id` cobre essa query
 *  (migration 20260929120922). RLS de `colaboradores` permite leitura
 *  pra admin/rh/próprio, mas não pro líder — e nem precisa: a query só
 *  conta rows onde `lider_id = profileId`, e o server usa o client
 *  padrão em contexto de layout, que roda com a sessão do usuário. Se
 *  a RLS bloquear, retorna NULL → `resolveFlagTemLiderados` → false.
 *
 *  Como a sidebar cai pra "não é líder" por default se a query falha,
 *  isso é fail-closed e é o comportamento desejado.
 */
export async function temLiderados(
  supabase: SupabaseClient,
  profileId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("colaboradores")
    .select("id")
    .eq("lider_id", profileId)
    .eq("tenant_id", tenantId)
    .limit(1);
  return resolveFlagTemLiderados(data);
}
