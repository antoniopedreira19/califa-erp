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
    beneficio_base_id: string | null;
  }>
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("beneficios")
    .select("id, nome, tipo, ativo, beneficio_base_id")
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
    beneficio_base_id: string | null;
  }>;
}

export interface VinculoDoColaborador {
  id: string;
  beneficio_id: string;
  beneficio_nome: string;
  beneficio_tipo: BeneficioTipo;
  modo_custeio: BeneficioModoCusteio;
  data_inicio: string;
  data_fim: string | null;
  observacao: string | null;
}

/**
 * Lista todos os vínculos de um colaborador (ativos e encerrados),
 * ordenados do mais recente pro mais antigo.
 */
export async function listarVinculosDoColaborador(args: {
  tenantId: string;
  colaboradorId: string;
}): Promise<VinculoDoColaborador[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaborador_beneficio")
    .select(
      `id, modo_custeio, data_inicio, data_fim, observacao,
       beneficio:beneficios ( id, nome, tipo )`,
    )
    .eq("tenant_id", args.tenantId)
    .eq("colaborador_id", args.colaboradorId)
    .order("data_inicio", { ascending: false });
  if (error) {
    throw new Error(`Erro ao listar vínculos: ${error.message}`);
  }
  type Row = {
    id: string;
    modo_custeio: BeneficioModoCusteio;
    data_inicio: string;
    data_fim: string | null;
    observacao: string | null;
    beneficio: { id: string; nome: string; tipo: BeneficioTipo } | null;
  };
  return (data as unknown as Row[] | null ?? []).map((r) => ({
    id: r.id,
    beneficio_id: r.beneficio?.id ?? "",
    beneficio_nome: r.beneficio?.nome ?? "—",
    beneficio_tipo: (r.beneficio?.tipo ?? "saude") as BeneficioTipo,
    modo_custeio: r.modo_custeio,
    data_inicio: r.data_inicio,
    data_fim: r.data_fim,
    observacao: r.observacao,
  }));
}

export interface DependenteComPlanos {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string;
  parentesco: string;
  ativo: boolean;
  data_inicio: string;
  data_fim: string | null;
  planos_incluidos: Array<{
    link_id: string;
    vinculo_id: string;
    beneficio_id: string;
    beneficio_nome: string;
    beneficio_tipo: BeneficioTipo;
    data_inicio: string;
  }>;
}

/**
 * Lista dependentes de um colaborador com os planos em que estão incluídos
 * (vínculos ativos nos quais o dep tem link ativo).
 */
export async function listarDependentesDoColaborador(args: {
  tenantId: string;
  colaboradorId: string;
}): Promise<DependenteComPlanos[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dependentes")
    .select(
      `id, nome, cpf, data_nascimento, parentesco, ativo, data_inicio, data_fim,
       inclusoes:colaborador_beneficio_dependente (
         id, data_inicio, data_fim,
         vinculo:colaborador_beneficio (
           id, data_fim,
           beneficio:beneficios ( id, nome, tipo )
         )
       )`,
    )
    .eq("tenant_id", args.tenantId)
    .eq("colaborador_id", args.colaboradorId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Erro ao listar dependentes: ${error.message}`);
  }
  type Inclusao = {
    id: string;
    data_inicio: string;
    data_fim: string | null;
    vinculo: {
      id: string;
      data_fim: string | null;
      beneficio: { id: string; nome: string; tipo: BeneficioTipo } | null;
    } | null;
  };
  type Row = {
    id: string;
    nome: string;
    cpf: string;
    data_nascimento: string;
    parentesco: string;
    ativo: boolean;
    data_inicio: string;
    data_fim: string | null;
    inclusoes: Inclusao[] | null;
  };
  return (data as unknown as Row[] | null ?? []).map((d) => ({
    id: d.id,
    nome: d.nome,
    cpf: d.cpf,
    data_nascimento: d.data_nascimento,
    parentesco: d.parentesco,
    ativo: d.ativo,
    data_inicio: d.data_inicio,
    data_fim: d.data_fim,
    planos_incluidos: (d.inclusoes ?? [])
      .filter((i) => i.data_fim === null && i.vinculo && i.vinculo.data_fim === null)
      .map((i) => ({
        link_id: i.id,
        vinculo_id: i.vinculo!.id,
        beneficio_id: i.vinculo!.beneficio?.id ?? "",
        beneficio_nome: i.vinculo!.beneficio?.nome ?? "—",
        beneficio_tipo: (i.vinculo!.beneficio?.tipo ?? "saude") as BeneficioTipo,
        data_inicio: i.data_inicio,
      })),
  }));
}

export interface ColaboradorBasico {
  id: string;
  nome: string;
  tipo_contratacao: string;
  funcao: string;
  data_admissao: string;
  data_nascimento: string | null;
  cpf: string | null;
}

export async function colaboradorPorId(args: {
  tenantId: string;
  colaboradorId: string;
}): Promise<ColaboradorBasico | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .select("id, nome, tipo_contratacao, funcao, data_admissao, data_nascimento, cpf")
    .eq("tenant_id", args.tenantId)
    .eq("id", args.colaboradorId)
    .maybeSingle();
  if (error) {
    throw new Error(`Erro ao carregar colaborador: ${error.message}`);
  }
  return data as ColaboradorBasico | null;
}
