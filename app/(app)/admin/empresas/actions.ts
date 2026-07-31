"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { empresaSchema } from "@/lib/validations/empresas";

export type ActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    regional_id: formData.get("regional_id")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
    inscricao_estadual: formData.get("inscricao_estadual")?.toString() ?? "",
    inscricao_municipal: formData.get("inscricao_municipal")?.toString() ?? "",
    logradouro: formData.get("logradouro")?.toString() ?? "",
    numero: formData.get("numero")?.toString() ?? "",
    complemento: formData.get("complemento")?.toString() ?? "",
    bairro: formData.get("bairro")?.toString() ?? "",
    cidade: formData.get("cidade")?.toString() ?? "",
    uf: formData.get("uf")?.toString() ?? "",
    cep: formData.get("cep")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    local_pagamento: formData.get("local_pagamento")?.toString() ?? "",
    instrucoes_nf: formData.get("instrucoes_nf")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_empresas_cnpj_por_tenant")) {
    return "Já existe uma empresa com este CNPJ no tenant.";
  }
  if (msg.includes("uniq_empresas_principal_por_tenant")) {
    return "Já existe outra empresa marcada como principal — recarregue a lista.";
  }
  if (msg.includes("empresas_regional_id_fkey")) {
    return "Regional inválida.";
  }
  if (msg.includes("chk_empresas_cnpj_formato")) {
    return "CNPJ inválido: deve ter 14 dígitos.";
  }
  if (msg.includes("chk_empresas_cep_formato")) {
    return "CEP inválido: deve ter 8 dígitos.";
  }
  if (msg.includes("chk_empresas_telefone_formato")) {
    return "Telefone inválido: deve ter 10 ou 11 dígitos.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * Cria uma empresa. Se `principal=true` foi solicitado (via campo hidden
 * no form), desmarca a principal atual do tenant no mesmo statement, para
 * o índice único parcial aceitar o INSERT.
 */
export async function criarEmpresa(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = empresaSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const marcarPrincipalFlag = formData.get("principal")?.toString() === "true";
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Se vai criar como principal, desmarca a atual primeiro.
  if (marcarPrincipalFlag) {
    const { error: updErr } = await supabase
      .from("empresas")
      .update({ principal: false })
      .eq("tenant_id", tenantId)
      .eq("principal", true);
    if (updErr) {
      console.error("[empresas.criar.zerar-principal]", updErr.message);
      return { ok: false, message: "Falha ao trocar a empresa principal." };
    }
  }

  const { data, error } = await supabase
    .from("empresas")
    .insert({
      ...parsed.data,
      tenant_id: tenantId,
      created_by: session.profile.id,
      principal: marcarPrincipalFlag,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[empresas.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "empresa.criada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: data.id,
    metadata: {
      razao_social: parsed.data.razao_social,
      cnpj: parsed.data.cnpj,
      principal: marcarPrincipalFlag,
    },
  });

  if (marcarPrincipalFlag) {
    await logAuditEvent({
      acao: "empresa.principal_alterada",
      tenantId,
      entidadeTipo: "empresa",
      entidadeId: data.id,
      metadata: { nova_principal_id: data.id },
    });
  }

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id: data.id, message: "Empresa cadastrada." };
}

/**
 * Atualiza uma empresa. `principal` NÃO entra por aqui — é ação própria
 * (marcarPrincipal). Ativo/inativo também são ações próprias.
 */
export async function atualizarEmpresa(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = empresaSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { error } = await supabase
    .from("empresas")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[empresas.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "empresa.atualizada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
  });

  revalidatePath("/admin/empresas");
  return { ok: true, id, message: "Empresa atualizada." };
}

/** Marca uma empresa como principal (desmarca a atual). */
export async function marcarPrincipal(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Confirma que a empresa existe e está ativa antes de mexer no flag.
  const { data: alvo, error: getErr } = await supabase
    .from("empresas")
    .select("id, ativo, principal")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (getErr || !alvo) {
    return { ok: false, message: "Empresa não encontrada." };
  }
  if (!alvo.ativo) {
    return { ok: false, message: "Não é possível marcar uma empresa inativa como principal." };
  }
  if (alvo.principal) {
    return { ok: true, id, message: "Empresa já é a principal." };
  }

  // Desmarca a principal atual (se houver).
  const { error: unsetErr } = await supabase
    .from("empresas")
    .update({ principal: false })
    .eq("tenant_id", tenantId)
    .eq("principal", true);
  if (unsetErr) {
    console.error("[empresas.marcarPrincipal.unset]", unsetErr.message);
    return { ok: false, message: "Falha ao trocar a empresa principal." };
  }

  const { error: setErr } = await supabase
    .from("empresas")
    .update({ principal: true })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (setErr) {
    console.error("[empresas.marcarPrincipal.set]", setErr.message);
    return { ok: false, message: "Falha ao marcar como principal." };
  }

  await logAuditEvent({
    acao: "empresa.principal_alterada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
    metadata: { nova_principal_id: id },
  });

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id, message: "Empresa marcada como principal." };
}

/** Soft-delete. Bloqueia se for a principal. */
export async function desativarEmpresa(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: alvo, error: getErr } = await supabase
    .from("empresas")
    .select("id, principal, ativo")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (getErr || !alvo) {
    return { ok: false, message: "Empresa não encontrada." };
  }
  if (alvo.principal) {
    return {
      ok: false,
      message: "Marque outra empresa como principal antes de desativar esta.",
    };
  }
  if (!alvo.ativo) {
    return { ok: true, id, message: "Empresa já estava inativa." };
  }

  const { error } = await supabase
    .from("empresas")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[empresas.desativar]", error.message);
    return { ok: false, message: "Não foi possível desativar." };
  }

  await logAuditEvent({
    acao: "empresa.desativada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
  });

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id, message: "Empresa desativada." };
}

/** Reativa uma empresa soft-deletada. */
export async function reativarEmpresa(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { error } = await supabase
    .from("empresas")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[empresas.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "empresa.reativada",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: id,
  });

  revalidatePath("/admin/empresas");
  revalidatePath("/admin");
  return { ok: true, id, message: "Empresa reativada." };
}
