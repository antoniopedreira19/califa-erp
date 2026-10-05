import { createClient } from "@/lib/supabase/server";
import type {
  BeneficioKpisTenant,
  BeneficioCustoMensalLinha,
  BeneficioTipo,
  BeneficioModoCusteio,
} from "@/lib/types";

export interface PlanoAtivoChip {
  beneficio_id: string;
  nome: string;
  tipo: BeneficioTipo;
}

export interface LinhaColaboradorBeneficios {
  colaborador_id: string;
  nome: string;
  tipo_contratacao: string;
  planos_ativos: PlanoAtivoChip[];
  custo_empresa: number;
  custo_colaborador: number;
}

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

/**
 * Lista colaboradores ativos do tenant com seus benefícios ativos na competência.
 * Filtros opcionais: busca por nome (ilike), benefício específico, modo de custeio.
 */
export async function listarColaboradoresComBeneficios(args: {
  tenantId: string;
  ano: number;
  mes: number;
  busca?: string;
  beneficioId?: string;
  modoCusteio?: BeneficioModoCusteio;
}): Promise<LinhaColaboradorBeneficios[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("fn_beneficios_listar_colaboradores", {
    p_tenant_id: args.tenantId,
    p_ano: args.ano,
    p_mes: args.mes,
    p_busca: args.busca ?? null,
    p_beneficio_id: args.beneficioId ?? null,
    p_modo: args.modoCusteio ?? null,
  });
  if (error) {
    throw new Error(`Erro ao listar colaboradores com benefícios: ${error.message}`);
  }
  return (data ?? []) as LinhaColaboradorBeneficios[];
}

/**
 * Lista todos os benefícios do catálogo do tenant.
 * Usado para popular selects de filtro e CRUD de catálogo.
 */
export async function listarBeneficiosDoCatalogo(args: {
  tenantId: string;
}): Promise<
  Array<{
    id: string;
    nome: string;
    tipo: BeneficioTipo;
    ativo: boolean;
  }>
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("beneficios")
    .select("id, nome, tipo, ativo")
    .eq("tenant_id", args.tenantId)
    .order("nome");
  if (error) {
    throw new Error(`Erro ao listar catálogo de benefícios: ${error.message}`);
  }
  return (data ?? []) as Array<{
    id: string;
    nome: string;
    tipo: BeneficioTipo;
    ativo: boolean;
  }>;
}
