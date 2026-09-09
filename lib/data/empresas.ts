import { unstable_cache } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Empresa } from "@/lib/types";

/**
 * Fetch cru (sem cache) das empresas ativas do tenant.
 * Usa service client — a lista de empresas de um tenant não é PII
 * sensível (razão social/CNPJ/endereço), e todo membro do tenant já
 * teria acesso via RLS. Bypassar RLS aqui é seguro e permite cachear
 * o resultado entre requests sem depender do JWT do usuário.
 */
async function fetchEmpresasByTenantUncached(tenantId: string): Promise<Empresa[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("empresas")
    .select(
      "id, tenant_id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email, local_pagamento, instrucoes_nf, principal, ativo, created_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("nome_fantasia", { ascending: true });

  if (error) {
    console.error("[empresas.fetchByTenant]", error.message);
    return [];
  }
  return (data ?? []) as Empresa[];
}

/**
 * Versão cachead ada de `fetchEmpresasByTenantUncached`, com TTL de 5 min
 * e tag "empresas" pra invalidação.
 *
 * Ao editar/criar/desativar uma empresa em /admin/empresas, as actions
 * chamam `revalidateTag("empresas")` — o cache é invalidado imediatamente
 * pra TODOS os usuários do tenant.
 *
 * Uso: `loadSession()` em `lib/auth/session.ts` é o principal consumidor.
 * Economiza ~100ms por request (fetch das empresas era feito toda vez).
 */
export const getEmpresasByTenantCached = unstable_cache(
  fetchEmpresasByTenantUncached,
  ["empresas-by-tenant"],
  { revalidate: 300, tags: ["empresas"] },
);

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
