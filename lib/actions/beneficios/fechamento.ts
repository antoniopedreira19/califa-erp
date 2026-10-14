"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import type { AplicarBeneficiosResult, PreviewAplicacao } from "@/lib/types";

type AplicarResult =
  | ({ ok: true } & AplicarBeneficiosResult)
  | { ok: false; message: string };

type DesaplicarResult = { ok: true } | { ok: false; message: string };

function assertAdminOuRh(role: string): { ok: false; message: string } | null {
  if (role !== "administrador" && role !== "rh") {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  return null;
}

function traduzErroRpc(message: string): string {
  if (message.includes("permissao_negada")) return "Você não tem permissão para aplicar/desaplicar benefícios.";
  if (message.includes("competencia_ja_aplicada")) return "Esta competência já está aplicada. Desaplique antes de reaplicar.";
  if (message.includes("catalogo_incompleto")) {
    const nome = message.split("catalogo_incompleto:").pop()?.trim() ?? "benefício";
    return `Catálogo de benefícios incompleto: ${nome}. Edite em /rh/beneficios → Catálogo (fornecedor, empresa, regional e vencimento são obrigatórios).`;
  }
  if (message.includes("nenhum_vinculo_ativo")) return "Nenhum vínculo de benefício ativo nesta competência.";
  if (message.includes("subtipo_beneficios_nao_encontrado")) return "Subtipo 'Benefícios' não encontrado no plano de contas.";
  if (message.includes("ja_reaberto")) return "Esta competência já foi reaberta.";
  if (message.includes("avulsa_ja_paga")) {
    const codigo = message.split("avulsa_ja_paga:").pop()?.trim() ?? "sem código";
    return `Não dá pra desaplicar: avulsa ${codigo} já foi paga. Estorne a avulsa pelo financeiro antes.`;
  }
  if (message.includes("fechamento_nao_encontrado")) return "Fechamento não encontrado.";
  return message;
}

export async function aplicarBeneficios(args: {
  ano: number;
  mes: number;
}): Promise<AplicarResult> {
  const session = await requireSession();
  const bloqueio = assertAdminOuRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const supabase = createClient();
  const { data, error } = await supabase.rpc("aplicar_fechamento_beneficios", {
    p_tenant_id: session.activeTenant.id,
    p_ano: args.ano,
    p_mes: args.mes,
  });

  if (error) {
    console.error("[beneficios.aplicar]", error);
    return { ok: false, message: traduzErroRpc(error.message) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, message: "A operação não retornou resultado." };
  }

  const resultado: AplicarBeneficiosResult = {
    fechamentoId: row.fechamento_id,
    qtdVinculos: Number(row.qtd_vinculos),
    totalEmpresa: Number(row.total_empresa),
    totalColaborador: Number(row.total_colaborador),
    folhaLinhasAfetadas: Number(row.folha_linhas_afetadas),
  };

  await logAuditEvent({
    acao: "beneficio.fechamento.aplicado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "beneficio_fechamento_mensal",
    entidadeId: resultado.fechamentoId,
    metadata: {
      ano: args.ano,
      mes: args.mes,
      qtd_vinculos: resultado.qtdVinculos,
      total_empresa: resultado.totalEmpresa,
      total_colaborador: resultado.totalColaborador,
      folha_linhas_afetadas: resultado.folhaLinhasAfetadas,
    },
  });

  const comp = `${args.ano}-${String(args.mes).padStart(2, "0")}`;
  revalidatePath(`/rh/folhas/${comp}`);
  revalidatePath("/rh/beneficios");

  return { ok: true, ...resultado };
}

export async function desaplicarBeneficios(args: {
  fechamentoId: string;
}): Promise<DesaplicarResult> {
  const session = await requireSession();
  const bloqueio = assertAdminOuRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const supabase = createClient();

  const { data: cabecalho } = await supabase
    .from("beneficio_fechamento_mensal")
    .select("ano, mes")
    .eq("id", args.fechamentoId)
    .single();

  const { error } = await supabase.rpc("desaplicar_fechamento_beneficios", {
    p_fechamento_id: args.fechamentoId,
  });

  if (error) {
    console.error("[beneficios.desaplicar]", error);
    return { ok: false, message: traduzErroRpc(error.message) };
  }

  await logAuditEvent({
    acao: "beneficio.fechamento.desaplicado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "beneficio_fechamento_mensal",
    entidadeId: args.fechamentoId,
    metadata: {
      fechamento_id: args.fechamentoId,
      ano: cabecalho?.ano ?? null,
      mes: cabecalho?.mes ?? null,
      motivo: "manual",
    },
  });

  if (cabecalho) {
    const comp = `${cabecalho.ano}-${String(cabecalho.mes).padStart(2, "0")}`;
    revalidatePath(`/rh/folhas/${comp}`);
  }
  revalidatePath("/rh/beneficios");

  return { ok: true };
}

/**
 * Preview para o confirm() do botão Aplicar — chama fn_beneficios_calcular_fechamento
 * sem gravar e agrega por operadora. Também calcula a data de vencimento.
 */
export async function previsualizarAplicacao(args: {
  ano: number;
  mes: number;
}): Promise<
  | { ok: true; preview: PreviewAplicacao }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  const bloqueio = assertAdminOuRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const supabase = createClient();
  const { data: linhas, error } = await supabase.rpc(
    "fn_beneficios_calcular_fechamento",
    {
      p_tenant_id: session.activeTenant.id,
      p_ano: args.ano,
      p_mes: args.mes,
    },
  );

  if (error) {
    console.error("[beneficios.preview]", error);
    return { ok: false, message: `Erro ao calcular preview: ${error.message}` };
  }

  const items = (linhas ?? []) as Array<{
    beneficio_id: string;
    beneficio_operadora: string;
    valor_integral: number;
    valor_empresa: number;
    valor_colaborador: number;
  }>;

  const { data: beneficios } = await supabase
    .from("beneficios")
    .select("id, dia_vencimento_fatura, vencimento_mes_seguinte")
    .eq("ativo", true);
  const vencPorBeneficio = new Map<string, { dia: number; mesSeguinte: boolean }>();
  (beneficios ?? []).forEach((b) => {
    if (b.dia_vencimento_fatura != null) {
      vencPorBeneficio.set(b.id, {
        dia: b.dia_vencimento_fatura,
        mesSeguinte: b.vencimento_mes_seguinte,
      });
    }
  });

  const porOperadoraMap = new Map<
    string,
    {
      valorIntegral: number;
      qtdVinculos: number;
      dia: number;
      mesSeguinte: boolean;
    }
  >();

  let totalEmpresa = 0;
  let totalColaborador = 0;
  let totalIntegral = 0;

  for (const l of items) {
    totalEmpresa += Number(l.valor_empresa);
    totalColaborador += Number(l.valor_colaborador);
    totalIntegral += Number(l.valor_integral);
    const venc = vencPorBeneficio.get(l.beneficio_id);
    const prev = porOperadoraMap.get(l.beneficio_operadora);
    if (prev) {
      prev.valorIntegral += Number(l.valor_integral);
      prev.qtdVinculos += 1;
    } else {
      porOperadoraMap.set(l.beneficio_operadora, {
        valorIntegral: Number(l.valor_integral),
        qtdVinculos: 1,
        dia: venc?.dia ?? 1,
        mesSeguinte: venc?.mesSeguinte ?? true,
      });
    }
  }

  function dataVencimento(dia: number, mesSeguinte: boolean): string {
    const base = new Date(args.ano, args.mes - 1, 1);
    if (mesSeguinte) base.setMonth(base.getMonth() + 1);
    base.setDate(dia);
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, "0");
    const d = String(base.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const porOperadora = Array.from(porOperadoraMap.entries()).map(([operadora, v]) => ({
    operadora,
    valorIntegral: v.valorIntegral,
    qtdVinculos: v.qtdVinculos,
    dataVencimento: dataVencimento(v.dia, v.mesSeguinte),
  }));

  return {
    ok: true,
    preview: {
      qtdVinculos: items.length,
      totalEmpresa,
      totalColaborador,
      totalIntegral,
      porOperadora,
    },
  };
}
