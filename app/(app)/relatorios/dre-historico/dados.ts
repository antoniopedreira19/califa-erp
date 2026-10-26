/**
 * As somas da DRE do histórico num ano de competência (decisão 211, A4): a
 * função `historico_dre` soma os movimentos das cargas ativas por Tipo e pela
 * chave de empréstimo da coluna Jobs; a regra de cada linha fica em
 * `lib/historico-financeiro/dre.ts`.
 */
import type { createClient } from "@/lib/supabase/server";
import { PREFIXOS_DA_DRE, type AgregadoPorGrupo, type AgregadoPorJobs } from "@/lib/historico-financeiro/dre";

type Supabase = ReturnType<typeof createClient>;

export interface SomasDaDre {
  /** O período que as cargas ativas cobrem; nulo quando não há carga. */
  cobertura: { de: string; ate: string } | null;
  porGrupo: AgregadoPorGrupo[];
  porJobs: AgregadoPorJobs[];
}

type Resposta = {
  cobertura: { de: string; ate: string } | null;
  grupos?: { sigla: string; grupo: string; trimestre: number; aba: string; credito: number | string; debito: number | string }[];
  jobs?: { prefixo: string; trimestre: number; aba: string; credito: number | string; debito: number | string }[];
};

/** As somas do ano, ou `null` quando a leitura falha. */
export async function carregarSomasDaDre(supabase: Supabase, tenantId: string, ano: number): Promise<SomasDaDre | null> {
  const { data, error } = await supabase.rpc("historico_dre", {
    p_tenant_id: tenantId,
    p_ano: ano,
    p_prefixos: [...PREFIXOS_DA_DRE],
  });
  if (error) {
    console.error("[relatorios.dre-historico]", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as Resposta;
  return {
    cobertura: r.cobertura,
    porGrupo: (r.grupos ?? []).map((g) => ({ ...g, credito: Number(g.credito), debito: Number(g.debito) })),
    porJobs: (r.jobs ?? []).map((j) => ({ ...j, credito: Number(j.credito), debito: Number(j.debito) })),
  };
}
