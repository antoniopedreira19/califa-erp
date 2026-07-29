"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { regionalSchema } from "@/lib/validations/regionais";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapRegionalDbError(msg: string): string {
  if (msg.includes("uniq_regional_nome_por_tenant")) {
    return "Já existe uma regional com esse nome.";
  }
  if (msg.includes("regionais_nome_nao_vazio")) {
    return "Nome da regional não pode ficar vazio.";
  }
  return "Não foi possível salvar a regional.";
}

export async function criarRegional(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = regionalSchema.safeParse({
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
    .from("regionais")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: parsed.data.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[regionais.criar]", error.message);
    return { ok: false, message: mapRegionalDbError(error.message) };
  }

  await logAuditEvent({
    acao: "regional.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/regionais");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function editarRegional(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = regionalSchema.safeParse({
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
    .from("regionais")
    .update({ nome: parsed.data.nome })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[regionais.editar]", error.message);
    return { ok: false, message: mapRegionalDbError(error.message) };
  }

  await logAuditEvent({
    acao: "regional.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/regionais");
  return { ok: true, id };
}

export async function inativarRegional(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return { ok: false, message: "Só administradores podem inativar regionais." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("regionais")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[regionais.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "regional.inativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: id,
  });

  revalidatePath("/cadastros/regionais");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarRegional(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return { ok: false, message: "Só administradores podem reativar regionais." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("regionais")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[regionais.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "regional.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "regional",
    entidadeId: id,
  });

  revalidatePath("/cadastros/regionais");
  revalidatePath("/cadastros");
  return { ok: true, id };
}
