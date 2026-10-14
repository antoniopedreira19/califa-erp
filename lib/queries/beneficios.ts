import { createClient } from "@/lib/supabase/server";
import type {
  BeneficioKpisTenant,
  BeneficioCustoMensalLinha,
  BeneficioTipo,
  BeneficioModoCusteio,
  FechamentoRow,
  FechamentoDetalhe,
  BeneficioFechamentoLinha,
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
  qtde_dependentes: number;
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

export interface BeneficioCompleto {
  id: string;
  nome: string;
  operadora: string;
  tipo: BeneficioTipo;
  modelo_preco: "faixa_etaria" | "flat";
  percentual_empresa_titular: number;
  percentual_colaborador_dependentes: number;
  valor_flat: number | null;
  beneficio_base_id: string | null;
  codigo_externo: string | null;
  ativo: boolean;
  observacao: string | null;
  faixas: Array<{
    id: string;
    idade_min: number;
    idade_max: number | null;
    valor: number;
  }>;
}

/**
 * Lista todos os benefícios com faixas aninhadas, para a tab Catálogo.
 */
export async function listarBeneficiosCompletos(args: {
  tenantId: string;
}): Promise<BeneficioCompleto[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("beneficios")
    .select(
      `id, nome, operadora, tipo, modelo_preco,
       percentual_empresa_titular, percentual_colaborador_dependentes,
       valor_flat, beneficio_base_id, codigo_externo, ativo, observacao,
       faixas:beneficio_faixas_preco ( id, idade_min, idade_max, valor )`,
    )
    .eq("tenant_id", args.tenantId)
    .order("nome");
  if (error) {
    throw new Error(`Erro ao listar catálogo completo: ${error.message}`);
  }
  type Row = Omit<BeneficioCompleto, "faixas"> & {
    faixas: Array<{
      id: string;
      idade_min: number;
      idade_max: number | null;
      valor: number;
    }> | null;
  };
  return (data as unknown as Row[] | null ?? []).map((b) => ({
    ...b,
    faixas: (b.faixas ?? []).sort((a, c) => a.idade_min - c.idade_min),
  }));
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

/**
 * Resumo compacto pro card de benefícios em /perfil. Combina vínculos
 * ativos + dependentes incluídos + breakdown da competência numa única
 * estrutura. Retorna null quando o colaborador não tem vínculo ativo.
 */
export async function resumoBeneficiosDoColaborador(args: {
  tenantId: string;
  colaboradorId: string;
  ano: number;
  mes: number;
}) {
  const [vinculos, dependentes, breakdown] = await Promise.all([
    listarVinculosDoColaborador({
      tenantId: args.tenantId,
      colaboradorId: args.colaboradorId,
    }),
    listarDependentesDoColaborador({
      tenantId: args.tenantId,
      colaboradorId: args.colaboradorId,
    }),
    custoMensalDoColaborador({
      ano: args.ano,
      mes: args.mes,
      colaboradorId: args.colaboradorId,
    }),
  ]);

  const vinculosAtivos = vinculos.filter((v) => v.data_fim === null);
  if (vinculosAtivos.length === 0) return null;

  const depsPorVinculo = new Map<string, number>();
  for (const d of dependentes) {
    if (!d.ativo || d.data_fim !== null) continue;
    for (const inc of d.planos_incluidos) {
      depsPorVinculo.set(
        inc.vinculo_id,
        (depsPorVinculo.get(inc.vinculo_id) ?? 0) + 1,
      );
    }
  }

  const qtdeDependentesTotal = dependentes.filter(
    (d) => d.ativo && d.data_fim === null && d.planos_incluidos.length > 0,
  ).length;

  const valorEmpresaMes = breakdown.reduce((s, l) => {
    const v = Number(l.valor_empresa_titular);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  const valorDescontoFolhaMes = breakdown.reduce((s, l) => {
    const v = Number(l.valor_desconto_folha_total);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);

  return {
    vinculos: vinculosAtivos.map((v) => ({
      beneficio_nome: v.beneficio_nome,
      beneficio_tipo: v.beneficio_tipo,
      modo_custeio: v.modo_custeio,
      qtde_dependentes_no_plano: depsPorVinculo.get(v.id) ?? 0,
    })),
    qtde_dependentes_total: qtdeDependentesTotal,
    valor_empresa_mes: valorEmpresaMes,
    valor_desconto_folha_mes: valorDescontoFolhaMes,
    competencia_mes: args.mes,
    competencia_ano: args.ano,
  };
}

// ============================================================================
// Fase 3 — Fechamentos (listar, obter detalhe, checar avulsa paga)
// ============================================================================

/** Lista fechamentos de uma competência/ano para o tenant, com totais agregados. */
export async function listarFechamentos(args: {
  tenantId: string;
  ano: number;
}): Promise<FechamentoRow[]> {
  const supabase = createClient();

  const { data: cabecalhos, error } = await supabase
    .from("beneficio_fechamento_mensal")
    .select(
      "id, tenant_id, ano, mes, fechado_em, fechado_por, reaberto_em, reaberto_por, observacao",
    )
    .eq("tenant_id", args.tenantId)
    .eq("ano", args.ano)
    .order("mes", { ascending: false });

  if (error) {
    throw new Error(`Erro ao listar fechamentos: ${error.message}`);
  }

  const rows = (cabecalhos ?? []) as Array<{
    id: string;
    tenant_id: string;
    ano: number;
    mes: number;
    fechado_em: string;
    fechado_por: string;
    reaberto_em: string | null;
    reaberto_por: string | null;
    observacao: string | null;
  }>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const [{ data: agregados }, { data: perfis }] = await Promise.all([
    supabase
      .from("beneficio_fechamento_linha")
      .select("fechamento_id, valor_empresa, valor_colaborador, valor_integral")
      .in("fechamento_id", ids),
    supabase
      .from("profiles")
      .select("id, nome")
      .in(
        "id",
        Array.from(
          new Set(
            rows
              .map((r) => r.fechado_por)
              .filter((v): v is string => Boolean(v)),
          ),
        ),
      ),
  ]);

  const porId = new Map<
    string,
    { total_empresa: number; total_colaborador: number; valor_integral: number; qtd_vinculos: number }
  >();
  for (const a of (agregados ?? []) as Array<{
    fechamento_id: string;
    valor_empresa: number;
    valor_colaborador: number;
    valor_integral: number;
  }>) {
    const prev = porId.get(a.fechamento_id) ?? {
      total_empresa: 0,
      total_colaborador: 0,
      valor_integral: 0,
      qtd_vinculos: 0,
    };
    prev.total_empresa += Number(a.valor_empresa);
    prev.total_colaborador += Number(a.valor_colaborador);
    prev.valor_integral += Number(a.valor_integral);
    prev.qtd_vinculos += 1;
    porId.set(a.fechamento_id, prev);
  }

  const nomePorPerfilId = new Map<string, string>(
    ((perfis ?? []) as Array<{ id: string; nome: string | null }>).map((p) => [
      p.id,
      p.nome ?? "",
    ]),
  );

  return rows.map((r) => {
    const agg = porId.get(r.id) ?? {
      total_empresa: 0,
      total_colaborador: 0,
      valor_integral: 0,
      qtd_vinculos: 0,
    };
    return {
      ...r,
      fechado_por_nome: nomePorPerfilId.get(r.fechado_por) ?? null,
      total_empresa: agg.total_empresa,
      total_colaborador: agg.total_colaborador,
      valor_integral: agg.valor_integral,
      qtd_vinculos: agg.qtd_vinculos,
    };
  });
}

/** Lista os anos distintos com fechamento (vigente ou reaberto) no tenant. */
export async function listarAnosComFechamento(args: {
  tenantId: string;
}): Promise<number[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("beneficio_fechamento_mensal")
    .select("ano")
    .eq("tenant_id", args.tenantId);
  const anos = new Set<number>();
  (data ?? []).forEach((r: { ano: number }) => anos.add(r.ano));
  return Array.from(anos).sort((a, b) => b - a);
}

/** Detalhe de um fechamento específico: cabeçalho + agregados por operadora + linhas. */
export async function obterFechamento(args: {
  fechamentoId: string;
}): Promise<FechamentoDetalhe | null> {
  const supabase = createClient();

  const { data: cabRaw } = await supabase
    .from("beneficio_fechamento_mensal")
    .select(
      "id, tenant_id, ano, mes, fechado_em, fechado_por, reaberto_em, reaberto_por, observacao",
    )
    .eq("id", args.fechamentoId)
    .single();

  if (!cabRaw) return null;

  const cab = cabRaw as {
    id: string;
    tenant_id: string;
    ano: number;
    mes: number;
    fechado_em: string;
    fechado_por: string;
    reaberto_em: string | null;
    reaberto_por: string | null;
    observacao: string | null;
  };

  const [{ data: linhasData }, { data: avulsasData }, { data: perfil }] = await Promise.all([
    supabase
      .from("beneficio_fechamento_linha")
      .select(
        "id, tenant_id, fechamento_id, colaborador_beneficio_id, colaborador_id, beneficio_id, beneficio_nome, beneficio_operadora, beneficio_tipo, modo_custeio, valor_titular, valor_dependentes_total, valor_integral, valor_empresa, valor_colaborador, qtd_dependentes_na_competencia, created_at",
      )
      .eq("fechamento_id", args.fechamentoId),
    supabase
      .from("contas_avulsas")
      .select("id, codigo, descricao, data_prevista_pagamento, pago_em, fornecedor_id")
      .eq("beneficio_fechamento_id", args.fechamentoId),
    supabase.from("profiles").select("nome").eq("id", cab.fechado_por).maybeSingle(),
  ]);

  const linhas = (linhasData ?? []) as BeneficioFechamentoLinha[];
  const avulsas = (avulsasData ?? []) as Array<{
    id: string;
    codigo: string | null;
    descricao: string;
    data_prevista_pagamento: string | null;
    pago_em: string | null;
    fornecedor_id: string | null;
  }>;

  const porOperadoraMap = new Map<
    string,
    {
      operadora: string;
      qtd_vinculos: number;
      valor_integral: number;
      valor_empresa: number;
      valor_colaborador: number;
    }
  >();
  let totEmp = 0;
  let totCol = 0;
  let totInt = 0;
  for (const l of linhas) {
    totEmp += Number(l.valor_empresa);
    totCol += Number(l.valor_colaborador);
    totInt += Number(l.valor_integral);
    const prev = porOperadoraMap.get(l.beneficio_operadora);
    if (prev) {
      prev.qtd_vinculos += 1;
      prev.valor_integral += Number(l.valor_integral);
      prev.valor_empresa += Number(l.valor_empresa);
      prev.valor_colaborador += Number(l.valor_colaborador);
    } else {
      porOperadoraMap.set(l.beneficio_operadora, {
        operadora: l.beneficio_operadora,
        qtd_vinculos: 1,
        valor_integral: Number(l.valor_integral),
        valor_empresa: Number(l.valor_empresa),
        valor_colaborador: Number(l.valor_colaborador),
      });
    }
  }

  // Associa avulsa à operadora pela descrição (formato: "Beneficios <operadora> - competencia MM/AAAA")
  function operadoraDaAvulsa(descricao: string): string | null {
    const m = descricao.match(/^Beneficios (.+?) - competencia/);
    return m?.[1] ?? null;
  }
  const avulsaPorOperadora = new Map<string, typeof avulsas[number]>();
  for (const a of avulsas) {
    const op = operadoraDaAvulsa(a.descricao);
    if (op) avulsaPorOperadora.set(op, a);
  }

  const por_operadora = Array.from(porOperadoraMap.values()).map((v) => {
    const a = avulsaPorOperadora.get(v.operadora);
    return {
      ...v,
      avulsa_id: a?.id ?? null,
      avulsa_codigo: a?.codigo ?? null,
      avulsa_vencimento: a?.data_prevista_pagamento ?? null,
      avulsa_pago_em: a?.pago_em ?? null,
    };
  });

  const cabecalho: FechamentoRow = {
    ...cab,
    fechado_por_nome: (perfil as { nome: string | null } | null)?.nome ?? null,
    total_empresa: totEmp,
    total_colaborador: totCol,
    valor_integral: totInt,
    qtd_vinculos: linhas.length,
  };

  return { cabecalho, por_operadora, linhas };
}

/** Checa se qualquer avulsa associada ao fechamento já foi paga. */
export async function temAvulsaPaga(args: {
  fechamentoId: string;
}): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("contas_avulsas")
    .select("id")
    .eq("beneficio_fechamento_id", args.fechamentoId)
    .not("pago_em", "is", null)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/** Retorna o fechamento VIGENTE (reaberto_em is null) de uma competência, se houver. */
export async function obterFechamentoVigenteDaCompetencia(args: {
  tenantId: string;
  ano: number;
  mes: number;
}): Promise<FechamentoRow | null> {
  const supabase = createClient();
  const { data: cab } = await supabase
    .from("beneficio_fechamento_mensal")
    .select(
      "id, tenant_id, ano, mes, fechado_em, fechado_por, reaberto_em, reaberto_por, observacao",
    )
    .eq("tenant_id", args.tenantId)
    .eq("ano", args.ano)
    .eq("mes", args.mes)
    .is("reaberto_em", null)
    .maybeSingle();

  if (!cab) return null;

  const [{ data: agregados }, { data: perfil }] = await Promise.all([
    supabase
      .from("beneficio_fechamento_linha")
      .select("valor_empresa, valor_colaborador, valor_integral")
      .eq("fechamento_id", cab.id),
    supabase.from("profiles").select("nome").eq("id", cab.fechado_por).maybeSingle(),
  ]);

  const agg = ((agregados ?? []) as Array<{
    valor_empresa: number;
    valor_colaborador: number;
    valor_integral: number;
  }>).reduce(
    (acc, cur) => ({
      total_empresa: acc.total_empresa + Number(cur.valor_empresa),
      total_colaborador: acc.total_colaborador + Number(cur.valor_colaborador),
      valor_integral: acc.valor_integral + Number(cur.valor_integral),
      qtd_vinculos: acc.qtd_vinculos + 1,
    }),
    { total_empresa: 0, total_colaborador: 0, valor_integral: 0, qtd_vinculos: 0 },
  );

  return {
    ...(cab as FechamentoRow),
    fechado_por_nome: (perfil as { nome: string | null } | null)?.nome ?? null,
    ...agg,
  };
}
