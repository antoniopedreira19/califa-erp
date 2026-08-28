import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaJobRentabilidade } from "@/lib/types";
import type { FiltrosRentabilidade } from "./parse-filtros";
import { periodoParaFaixaDatas } from "./parse-filtros";

/**
 * Lê `vw_job_rentabilidade` filtrada por período e dimensões.
 *
 * Trimestres somam-se via OR de faixas de data — se o usuário selecionou
 * Q1 e Q3, a query pega jobs abertos em jan-mar OU jul-set. `filter` do
 * postgrest não suporta múltiplos ranges em uma coluna, então quando há
 * mais de 1 trimestre a query é feita N vezes com Promise.all e o
 * resultado é concatenado + dedupe por job_id.
 *
 * `faturamentoMinimo` NÃO é aplicado aqui — ele filtra o grupo depois da
 * agregação (spec §3.6).
 */
export async function carregarLinhas(
  supabase: SupabaseClient,
  tenantId: string,
  ano: number,
  filtros: Omit<FiltrosRentabilidade, "ano" | "compararAno" | "faturamentoMinimo" | "modo" | "visao">,
): Promise<LinhaJobRentabilidade[]> {
  const faixas = periodoParaFaixaDatas(ano, filtros.trimestres);

  const consultarFaixa = async (faixa: { inicio: string; fim: string }) => {
    let query = supabase
      .from("vw_job_rentabilidade")
      .select(
        "job_id, tenant_id, empresa_id, regional_id, cliente_id, marca_id, job_codigo, job_nome, data_abertura_financeiro, faturamento_previsto, imposto_previsto, faturamento_realizado, imposto_realizado, custo_realizado, bv_realizado",
      )
      .eq("tenant_id", tenantId)
      .gte("data_abertura_financeiro", faixa.inicio)
      .lte("data_abertura_financeiro", faixa.fim);

    if (filtros.empresasIds.length > 0) query = query.in("empresa_id", filtros.empresasIds);
    if (filtros.regionaisIds.length > 0) query = query.in("regional_id", filtros.regionaisIds);
    if (filtros.clientesIds.length > 0) query = query.in("cliente_id", filtros.clientesIds);
    if (filtros.marcasIds.length > 0) query = query.in("marca_id", filtros.marcasIds);

    const { data, error } = await query;
    if (error) {
      console.error("[relatorios.rentabilidade.carregar-linhas]", error.message);
      return [];
    }
    return (data ?? []) as LinhaJobRentabilidade[];
  };

  // Uma faixa só (ano inteiro ou 1 trimestre) — query única.
  if (faixas.length === 1) return consultarFaixa(faixas[0]);

  // Múltiplos trimestres — Promise.all + dedupe por job_id.
  const resultados = await Promise.all(faixas.map(consultarFaixa));
  const dedupe = new Map<string, LinhaJobRentabilidade>();
  for (const linhas of resultados) {
    for (const l of linhas) dedupe.set(l.job_id, l);
  }
  return Array.from(dedupe.values());
}
