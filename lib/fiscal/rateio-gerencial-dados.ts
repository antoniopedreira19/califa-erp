/**
 * As regras do rateio por empresa gerencial lidas do banco (decisão 277): as
 * empresas gerenciais ativas com as regionais delas e, por CNPJ, a regional
 * padrão (a GoCrazy → SS), que leva a parte da gerencial do CNPJ inteira.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmpresaDoRateio, RegrasDoRateio } from "./rateio-gerencial";

export interface RegrasDoRateioDoTenant {
  empresas: EmpresaDoRateio[];
  /** Por CNPJ (empresa contábil): a regional padrão dele, se tem. */
  regionalDoCnpj: Record<string, { empresa_id: string; regional_id: string } | null>;
  /** Por CNPJ: a empresa gerencial dele (a sugestão do rateio quando não há receita). */
  gerencialDoCnpj: Record<string, string | null>;
}

export async function carregarRegrasDoRateio(supabase: SupabaseClient, tenantId: string): Promise<RegrasDoRateioDoTenant> {
  const [empresasRes, pjsRes] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, nome_fantasia, razao_social, regionais(id, nome, ativo)")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("empresas_contabeis")
      .select("id, empresa_gerencial_id, regional_padrao_id, regional:regionais!regional_padrao_id(empresa_id)")
      .eq("tenant_id", tenantId),
  ]);
  if (empresasRes.error) throw new Error(`[fiscal.rateio.empresas] ${empresasRes.error.message}`);
  if (pjsRes.error) throw new Error(`[fiscal.rateio.cnpjs] ${pjsRes.error.message}`);

  type Empresa = {
    id: string;
    nome_fantasia: string | null;
    razao_social: string;
    regionais: Array<{ id: string; nome: string; ativo: boolean }> | null;
  };
  const empresas: EmpresaDoRateio[] = ((empresasRes.data ?? []) as unknown as Empresa[]).map((e) => ({
    id: e.id,
    nome: e.nome_fantasia?.trim() || e.razao_social,
    regionais: (e.regionais ?? [])
      .filter((r) => r.ativo)
      .map((r) => ({ id: r.id, nome: r.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
  }));

  type Pj = { id: string; empresa_gerencial_id: string | null; regional_padrao_id: string | null; regional: { empresa_id: string } | null };
  const regionalDoCnpj: RegrasDoRateioDoTenant["regionalDoCnpj"] = {};
  const gerencialDoCnpj: RegrasDoRateioDoTenant["gerencialDoCnpj"] = {};
  for (const p of (pjsRes.data ?? []) as unknown as Pj[]) {
    regionalDoCnpj[p.id] = p.regional_padrao_id && p.regional ? { empresa_id: p.regional.empresa_id, regional_id: p.regional_padrao_id } : null;
    gerencialDoCnpj[p.id] = p.empresa_gerencial_id;
  }
  return { empresas, regionalDoCnpj, gerencialDoCnpj };
}

/** As regras para a guia de um CNPJ. */
export function regrasDoCnpj(t: RegrasDoRateioDoTenant, pjId: string): RegrasDoRateio {
  return { empresas: t.empresas, regionalDoCnpj: t.regionalDoCnpj[pjId] ?? null };
}
