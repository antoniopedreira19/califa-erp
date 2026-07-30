"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { clienteSchema } from "@/lib/validations/clientes";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    codigo_curto: formData.get("codigo_curto")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    observacoes: formData.get("observacoes")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_clientes_cnpj_por_tenant")) {
    return "Já existe um cliente com este CNPJ neste tenant.";
  }
  if (msg.includes("clientes_cnpj_only_digits")) {
    return "CNPJ deve conter apenas dígitos.";
  }
  if (msg.includes("uniq_clientes_codigo_curto_por_tenant")) {
    return "Já existe um cliente com este código.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

export async function criarCliente(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = clienteSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[clientes.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cliente.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: data.id,
    metadata: { nome_fantasia: parsed.data.nome_fantasia },
  });

  revalidatePath("/clientes");
  redirect("/clientes");
}

export async function atualizarCliente(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = clienteSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("clientes")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cliente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${id}`);
  return { ok: true, id };
}

export async function inativarCliente(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("clientes")
    .update({ status: "inativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "cliente.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
  });

  revalidatePath("/clientes");
  return { ok: true, id };
}

export async function reativarCliente(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("clientes")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "cliente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
    metadata: { acao: "reativado" },
  });

  revalidatePath("/clientes");
  return { ok: true, id };
}
