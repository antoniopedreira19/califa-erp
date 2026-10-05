import { createClient } from "@/lib/supabase/server";
import type {
  BeneficioKpisTenant,
  BeneficioCustoMensalLinha,
} from "@/lib/types";

/**
 * KPIs agregados da página /rh/beneficios para uma competência.
 * Chama a RPC fn_beneficios_custo_mensal_tenant que agrega todos os
 * colaboradores ativos do tenant.
 */
export async function kpisTenantBeneficios(args: {
  tenantId: string;
  ano: number;
  mes: number;
}): Promise<BeneficioKpisTenant> {
  const supabase = createClient();
  const { data, error } = await supabase
    .rpc("fn_beneficios_custo_mensal_tenant", {
      p_tenant_id: args.tenantId,
      p_ano: args.ano,
      p_mes: args.mes,
    })
    .single();
  if (error) {
    throw new Error(`Erro ao calcular KPIs de benefícios: ${error.message}`);
  }
  if (!data) {
    return {
      qtde_vinculos_saude: 0,
      qtde_vinculos_dental: 0,
      custo_total_empresa: 0,
      custo_total_colaboradores: 0,
    };
  }
  return data as BeneficioKpisTenant;
}

/**
 * Custo mensal detalhado por vínculo de um colaborador na competência.
 * Chama a RPC fn_beneficios_custo_mensal.
 */
export async function custoMensalDoColaborador(args: {
  ano: number;
  mes: number;
  colaboradorId: string;
}): Promise<BeneficioCustoMensalLinha[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("fn_beneficios_custo_mensal", {
    p_ano: args.ano,
    p_mes: args.mes,
    p_colaborador_id: args.colaboradorId,
  });
  if (error) {
    throw new Error(`Erro ao calcular custo mensal: ${error.message}`);
  }
  return (data ?? []) as BeneficioCustoMensalLinha[];
}
