import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolve a flag "tem liderados" a partir do resultado bruto da query.
 *  Função pura — a parte testável do `temLiderados` fica aqui, isolada
 *  do I/O. */
export function resolveFlagTemLiderados(
  data: { id: string }[] | null,
): boolean {
  return Array.isArray(data) && data.length > 0;
}

/** True se o profile (pelo `profileId`) é líder (um dos N) de pelo menos
 *  1 colaborador. Usado no layout pra decidir se o item "Equipe" aparece
 *  na sidebar.
 *
 *  Query olha `colaboradores_lideres` (tabela N:N) e usa a policy RLS
 *  `colab_lideres_select_proprio` — que libera leitura quando o caller
 *  é o próprio líder. A policy filtra por `lider_id = auth.uid()`, então
 *  mesmo sem acesso de admin/rh o caller enxerga as suas próprias linhas.
 *
 *  `tenantId` segue na assinatura por contrato com o layout, mas NÃO é
 *  usado na query — a tabela N:N não tem `tenant_id` direto (vem via
 *  `colaboradores`). Dois tenants distintos com o mesmo profileId são
 *  impossíveis na prática (profile é global). Se virar necessário,
 *  juntar via `colaboradores` por `tenant_id`.
 *
 *  Fail-closed: query vazia ou com erro → `resolveFlagTemLiderados` → false.
 */
export async function temLiderados(
  supabase: SupabaseClient,
  profileId: string,
  _tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("colaboradores_lideres")
    .select("colaborador_id")
    .eq("lider_id", profileId)
    .limit(1);
  return resolveFlagTemLiderados(
    (data ?? null) as { id: string }[] | null,
  );
}
