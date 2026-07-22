"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { fornecedorSchema } from "@/lib/validations/fornecedores";
import type { TipoPessoa } from "@/lib/types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    tipo_pessoa: (formData.get("tipo_pessoa")?.toString() ??
      "juridica") as TipoPessoa,
    nome: formData.get("nome")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    cpf_cnpj: formData.get("cpf_cnpj")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    observacoes: formData.get("observacoes")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_fornecedores_documento_por_tenant")) {
    return "Já existe um fornecedor com este documento neste tenant.";
  }
  if (msg.includes("fornecedores_documento_formato")) {
    return "Documento não confere com o tipo de pessoa selecionado.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

export async function criarFornecedor(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = fornecedorSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[fornecedores.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "fornecedor.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome, tipo_pessoa: parsed.data.tipo_pessoa },
  });

  revalidatePath("/fornecedores");
  redirect(`/fornecedores/${data.id}`);
}

export async function atualizarFornecedor(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = fornecedorSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("fornecedores")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
  });

  revalidatePath("/fornecedores");
  revalidatePath(`/fornecedores/${id}`);
  return { ok: true, id };
}

export async function inativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "inativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
  });

  revalidatePath("/fornecedores");
  return { ok: true, id };
}

export async function reativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
    metadata: { acao: "reativado" },
  });

  revalidatePath("/fornecedores");
  return { ok: true, id };
}
