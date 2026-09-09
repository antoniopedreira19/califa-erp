import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

export interface PermissoesUser {
  empresaIds: string[];
  regionaisPorEmpresa: Record<string, "all" | string[]>;
  isTenantAdmin: boolean;
}

async function fetchPermissoesDoUserUncached(
  userId: string,
  tenantId: string,
): Promise<PermissoesUser> {
  const supabase = createServiceClient();

  const { data: adminRow } = await supabase
    .from("tenant_members")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("role", "administrador")
    .eq("status", "ativo")
    .maybeSingle();

  if (adminRow) {
    const { data: empresas } = await supabase
      .from("empresas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true);

    const empresaIds = (empresas ?? []).map((e) => e.id as string);
    const regionaisPorEmpresa: Record<string, "all" | string[]> = {};
    for (const id of empresaIds) regionaisPorEmpresa[id] = "all";

    return { empresaIds, regionaisPorEmpresa, isTenantAdmin: true };
  }

  const { data: rows } = await supabase
    .from("empresa_members")
    .select("empresa_id, regional_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("status", "ativo");

  const empresaIds = new Set<string>();
  const regionaisPorEmpresa: Record<string, "all" | string[]> = {};

  for (const r of rows ?? []) {
    const empresaId = r.empresa_id as string;
    empresaIds.add(empresaId);
    if (r.regional_id === null) {
      regionaisPorEmpresa[empresaId] = "all";
    } else {
      const atual = regionaisPorEmpresa[empresaId];
      if (atual === "all") continue;
      if (Array.isArray(atual)) {
        atual.push(r.regional_id as string);
      } else {
        regionaisPorEmpresa[empresaId] = [r.regional_id as string];
      }
    }
  }

  return {
    empresaIds: Array.from(empresaIds),
    regionaisPorEmpresa,
    isTenantAdmin: false,
  };
}

export function getPermissoesDoUserCached(
  userId: string,
  tenantId: string,
): Promise<PermissoesUser> {
  const cached = unstable_cache(
    () => fetchPermissoesDoUserUncached(userId, tenantId),
    ["permissoes-user", userId, tenantId],
    { revalidate: 300, tags: [`user-permissions:${userId}`] },
  );
  return cached();
}
