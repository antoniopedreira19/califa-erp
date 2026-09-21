"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import {
  empresaContabilSchema,
  configCnabSantanderSchema,
} from "@/lib/validations/empresas-contabeis";

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

/**
 * Salva a configuração CNAB Santander da empresa contábil. Necessária
 * pra que o módulo pgto-remessa consiga gerar arquivos de remessa em
 * nome dessa PJ. Só admin — dado sensível (convênio bancário).
 */
export async function salvarConfigCnabEmpresaContabil(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();

  const parsed = configCnabSantanderSchema.safeParse({
    convenio_cnab_santander:
      formData.get("convenio_cnab_santander")?.toString() ?? "",
    agencia_debito: formData.get("agencia_debito")?.toString() ?? "",
    agencia_debito_dv: formData.get("agencia_debito_dv")?.toString() ?? "",
    conta_debito: formData.get("conta_debito")?.toString() ?? "",
    conta_debito_dv: formData.get("conta_debito_dv")?.toString() ?? "",
    sequencial_arquivo: formData.get("sequencial_arquivo")?.toString() ?? "",
    endereco_logradouro:
      formData.get("endereco_logradouro")?.toString() ?? "",
    endereco_cidade: formData.get("endereco_cidade")?.toString() ?? "",
    endereco_cep: formData.get("endereco_cep")?.toString() ?? "",
    endereco_uf: formData.get("endereco_uf")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("empresas_contabeis")
    .update({
      convenio_cnab_santander: parsed.data.convenio_cnab_santander,
      agencia_debito: parsed.data.agencia_debito,
      agencia_debito_dv: parsed.data.agencia_debito_dv,
      conta_debito: parsed.data.conta_debito,
      conta_debito_dv: parsed.data.conta_debito_dv,
      sequencial_arquivo: parsed.data.sequencial_arquivo,
      endereco_logradouro: parsed.data.endereco_logradouro,
      endereco_cidade: parsed.data.endereco_cidade,
      endereco_cep: parsed.data.endereco_cep,
      endereco_uf: parsed.data.endereco_uf,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[empresas_contabeis.config_cnab]", error.message);
    return { ok: false, message: "Não foi possível salvar a configuração." };
  }

  await logAuditEvent({
    acao: "empresa_contabil.config_cnab_editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "empresa_contabil",
    entidadeId: id,
    metadata: {
      tem_convenio: parsed.data.convenio_cnab_santander !== null,
      sequencial: parsed.data.sequencial_arquivo,
    },
  });
  revalidatePath("/admin/empresas");
  return { ok: true, id };
}
