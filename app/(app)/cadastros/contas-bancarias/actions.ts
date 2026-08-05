"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { contaBancariaSchema } from "@/lib/validations/contas-bancarias";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const ROLES_PERMITIDOS = ["administrador", "financeiro"] as const;

function temPermissao(role: string): boolean {
  return (ROLES_PERMITIDOS as readonly string[]).includes(role);
}

function mapDbError(msg: string): string {
  if (msg.includes("contas_bancarias_nome_empresa_uq")) {
    return "Já existe uma conta bancária com esse nome para esta empresa.";
  }
  return "Não foi possível salvar a conta bancária.";
}

export async function criarContaBancaria(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "conta_bancaria.criada" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const parsed = contaBancariaSchema.safeParse({
    empresa_id: formData.get("empresa_id")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    banco: formData.get("banco")?.toString() ?? "",
    agencia: formData.get("agencia")?.toString() ?? "",
    numero_conta: formData.get("numero_conta")?.toString() ?? "",
    tipo: formData.get("tipo")?.toString() ?? "",
    saldo_inicial: formData.get("saldo_inicial")?.toString() ?? "",
    saldo_inicial_data: formData.get("saldo_inicial_data")?.toString() ?? "",
    ordem: formData.get("ordem")?.toString() ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const d = parsed.data;
  const supabase = createClient();

  const { data, error } = await supabase
    .from("contas_bancarias")
    .insert({
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      nome: d.nome,
      banco: d.banco,
      agencia: d.agencia || null,
      numero_conta: d.numero_conta || null,
      tipo: d.tipo,
      saldo_inicial: Number(d.saldo_inicial),
      saldo_inicial_data: d.saldo_inicial_data,
      ordem: d.ordem,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[contas_bancarias.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "conta_bancaria.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_bancaria",
    entidadeId: data.id,
    metadata: { nome: d.nome, banco: d.banco, empresa_id: d.empresa_id },
  });

  revalidatePath("/cadastros/contas-bancarias");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function editarContaBancaria(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "conta_bancaria.atualizada" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const parsed = contaBancariaSchema.safeParse({
    empresa_id: formData.get("empresa_id")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    banco: formData.get("banco")?.toString() ?? "",
    agencia: formData.get("agencia")?.toString() ?? "",
    numero_conta: formData.get("numero_conta")?.toString() ?? "",
    tipo: formData.get("tipo")?.toString() ?? "",
    saldo_inicial: formData.get("saldo_inicial")?.toString() ?? "",
    saldo_inicial_data: formData.get("saldo_inicial_data")?.toString() ?? "",
    ordem: formData.get("ordem")?.toString() ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const d = parsed.data;
  const supabase = createClient();

  // Verificar se há lançamentos financeiros vinculados (Task 5 pode não ter rodado ainda)
  let temLancamento = false;
  try {
    const { count, error: countError } = await supabase
      .from("lancamentos_financeiros")
      .select("*", { count: "exact", head: true })
      .eq("conta_bancaria_id", id);
    if (!countError) temLancamento = (count ?? 0) > 0;
  } catch (_) {
    // Tabela ainda não existe (task 5 não rodou) — tratar como sem lançamento
  }

  if (temLancamento) {
    // Buscar valores atuais pra comparar
    const { data: atual } = await supabase
      .from("contas_bancarias")
      .select("saldo_inicial, saldo_inicial_data")
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id)
      .single();

    if (atual) {
      const fieldErrors: Record<string, string[]> = {};
      if (String(d.saldo_inicial) !== String(atual.saldo_inicial)) {
        fieldErrors.saldo_inicial = [
          "Não é possível alterar o saldo inicial de uma conta com lançamentos.",
        ];
      }
      if (d.saldo_inicial_data !== atual.saldo_inicial_data) {
        fieldErrors.saldo_inicial_data = [
          "Não é possível alterar a data do saldo inicial de uma conta com lançamentos.",
        ];
      }
      if (Object.keys(fieldErrors).length > 0) {
        return {
          ok: false,
          message: "Conta com lançamentos: saldo inicial e data não podem ser alterados.",
          fieldErrors,
        };
      }
    }
  }

  const { error } = await supabase
    .from("contas_bancarias")
    .update({
      empresa_id: d.empresa_id,
      nome: d.nome,
      banco: d.banco,
      agencia: d.agencia || null,
      numero_conta: d.numero_conta || null,
      tipo: d.tipo,
      saldo_inicial: Number(d.saldo_inicial),
      saldo_inicial_data: d.saldo_inicial_data,
      ordem: d.ordem,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[contas_bancarias.editar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "conta_bancaria.atualizada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_bancaria",
    entidadeId: id,
    metadata: { nome: d.nome, banco: d.banco, empresa_id: d.empresa_id },
  });

  revalidatePath("/cadastros/contas-bancarias");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function inativarContaBancaria(id: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "conta_bancaria.inativada" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const supabase = createClient();

  // Verificar lançamentos nos últimos 90 dias
  try {
    const noventa_dias_atras = new Date();
    noventa_dias_atras.setDate(noventa_dias_atras.getDate() - 90);
    const dataCorte = noventa_dias_atras.toISOString().slice(0, 10);

    const { count, error: countError } = await supabase
      .from("lancamentos_financeiros")
      .select("*", { count: "exact", head: true })
      .eq("conta_bancaria_id", id)
      .gte("data_movimento", dataCorte);

    if (!countError && (count ?? 0) > 0) {
      return {
        ok: false,
        message:
          "Conta com movimento recente não pode ser inativada. Verifique com o financeiro.",
      };
    }
  } catch (_) {
    // Tabela ainda não existe — tratar como sem lançamento
  }

  const { error } = await supabase
    .from("contas_bancarias")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[contas_bancarias.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "conta_bancaria.inativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_bancaria",
    entidadeId: id,
  });

  revalidatePath("/cadastros/contas-bancarias");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarContaBancaria(id: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "conta_bancaria.reativada" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const supabase = createClient();

  const { error } = await supabase
    .from("contas_bancarias")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[contas_bancarias.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "conta_bancaria.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_bancaria",
    entidadeId: id,
  });

  revalidatePath("/cadastros/contas-bancarias");
  revalidatePath("/cadastros");
  return { ok: true, id };
}
