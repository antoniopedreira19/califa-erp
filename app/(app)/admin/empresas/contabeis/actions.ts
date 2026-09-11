"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { empresaContabilSchema } from "@/lib/validations/empresas-contabeis";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function parseForm(formData: FormData) {
  return empresaContabilSchema.safeParse({
    razao_social: formData.get("razao_social")?.toString() ?? "",
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
  });
}

function mapDbError(msg: string): string {
  if (msg.includes("empresas_contabeis_cnpj_tenant_uk"))
    return "Já existe uma empresa contábil com esse CNPJ neste tenant.";
  if (msg.includes("empresas_contabeis_cnpj_digits_chk"))
    return "CNPJ inválido — deve ter 14 dígitos.";
  return "Não foi possível salvar a empresa contábil.";
}

export async function criarEmpresaContabil(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = parseForm(formData);
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
    .from("empresas_contabeis")
    .insert({
      tenant_id: session.activeTenant.id,
      razao_social: d.razao_social,
      nome_fantasia: d.nome_fantasia || null,
      cnpj: d.cnpj,
      created_by: session.profile.id,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[empresas_contabeis.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }
  await logAuditEvent({
    acao: "empresa_contabil.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "empresa_contabil",
    entidadeId: data.id,
    metadata: { razao_social: d.razao_social, cnpj: d.cnpj },
  });
  revalidatePath("/admin/empresas");
  return { ok: true, id: data.id };
}

export async function editarEmpresaContabil(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;
  const supabase = createClient();
  const { error } = await supabase
    .from("empresas_contabeis")
    .update({
      razao_social: d.razao_social,
      nome_fantasia: d.nome_fantasia || null,
      cnpj: d.cnpj,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) {
    console.error("[empresas_contabeis.editar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }
  await logAuditEvent({
    acao: "empresa_contabil.atualizada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "empresa_contabil",
    entidadeId: id,
    metadata: { razao_social: d.razao_social, cnpj: d.cnpj },
  });
  revalidatePath("/admin/empresas");
  return { ok: true, id };
}

async function alterarAtivo(
  id: string,
  novoAtivo: boolean,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const supabase = createClient();
  const { error } = await supabase
    .from("empresas_contabeis")
    .update({ ativo: novoAtivo, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) {
    console.error("[empresas_contabeis.ativo]", error.message);
    return { ok: false, message: "Não foi possível alterar o status." };
  }
  await logAuditEvent({
    acao: novoAtivo
      ? "empresa_contabil.reativada"
      : "empresa_contabil.desativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "empresa_contabil",
    entidadeId: id,
  });
  revalidatePath("/admin/empresas");
  return { ok: true, id };
}

export async function inativarEmpresaContabil(
  id: string,
): Promise<ActionResult> {
  return alterarAtivo(id, false);
}

export async function reativarEmpresaContabil(
  id: string,
): Promise<ActionResult> {
  return alterarAtivo(id, true);
}
