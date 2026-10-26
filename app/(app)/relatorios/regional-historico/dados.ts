/**
 * As somas do resultado por regional do histórico num ano de competência
 * (decisão 211, A4): a função `historico_regional` soma os movimentos das
 * cargas ativas por Tipo e regional, e devolve a tabela de rateio de todos os
 * anos. A regra de cada linha fica em `lib/historico-financeiro/regional.ts`.
 */
import type { createClient } from "@/lib/supabase/server";
import {
  PREFIXOS_DO_REGIONAL,
  type AgregadoRegional,
  type AgregadoRegionalJobs,
  type PercentualDoRateio,
} from "@/lib/historico-financeiro/regional";

type Supabase = ReturnType<typeof createClient>;

export interface SomasDoRegional {
  /** O período que as cargas ativas cobrem; nulo quando não há carga. */
  cobertura: { de: string; ate: string } | null;
  /** A tabela de rateio de todos os anos, como a planilha registra. */
  rateio: PercentualDoRateio[];
  porGrupo: AgregadoRegional[];
  porJobs: AgregadoRegionalJobs[];
}

type Numero = number | string;
type Resposta = {
  cobertura: { de: string; ate: string } | null;
  rateio?: (Omit<PercentualDoRateio, "percentual"> & { percentual: Numero })[];
  grupos?: (Omit<AgregadoRegional, "credito" | "debito"> & { credito: Numero; debito: Numero })[];
  jobs?: (Omit<AgregadoRegionalJobs, "credito" | "debito"> & { credito: Numero; debito: Numero })[];
};

/** As somas do ano, ou `null` quando a leitura falha. */
export async function carregarSomasDoRegional(supabase: Supabase, tenantId: string, ano: number): Promise<SomasDoRegional | null> {
  const { data, error } = await supabase.rpc("historico_regional", {
    p_tenant_id: tenantId,
    p_ano: ano,
    p_prefixos: [...PREFIXOS_DO_REGIONAL],
  });
  if (error) {
    console.error("[relatorios.regional-historico]", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as Resposta;
  return {
    cobertura: r.cobertura,
    rateio: (r.rateio ?? []).map((p) => ({ ...p, percentual: Number(p.percentual) })),
    porGrupo: (r.grupos ?? []).map((g) => ({ ...g, credito: Number(g.credito), debito: Number(g.debito) })),
    porJobs: (r.jobs ?? []).map((j) => ({ ...j, credito: Number(j.credito), debito: Number(j.debito) })),
  };
}
