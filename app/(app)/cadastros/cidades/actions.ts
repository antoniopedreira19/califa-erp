"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { cidadeSchema } from "@/lib/validations/cidades";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapCidadeDbError(msg: string): string {
  if (msg.includes("uniq_cidade_por_tenant")) {
    return "Já existe uma cidade com esse nome.";
  }
  if (msg.includes("cidades_nome_nao_vazio")) {
    return "Nome da cidade não pode ficar vazio.";
  }
  return "Não foi possível salvar a cidade.";
}

export async function criarCidade(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = cidadeSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("cidades")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: parsed.data.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[cidades.criar]", error.message);
    return { ok: false, message: mapCidadeDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cidade.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cidade",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/cidades");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function editarCidade(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = cidadeSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
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
    .from("cidades")
    .update({ nome: parsed.data.nome })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[cidades.editar]", error.message);
    return { ok: false, message: mapCidadeDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cidade.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cidade",
    entidadeId: id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/cidades");
  return { ok: true, id };
}

export async function inativarCidade(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return { ok: false, message: "Só administradores podem inativar cidades." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("cidades")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[cidades.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "cidade.inativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cidade",
    entidadeId: id,
  });

  revalidatePath("/cadastros/cidades");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarCidade(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return { ok: false, message: "Só administradores podem reativar cidades." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("cidades")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[cidades.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "cidade.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cidade",
    entidadeId: id,
  });

  revalidatePath("/cadastros/cidades");
  revalidatePath("/cadastros");
  return { ok: true, id };
}
