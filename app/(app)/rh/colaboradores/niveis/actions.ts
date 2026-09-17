"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import { nivelSchema } from "@/lib/validations/rh-niveis";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapNivelDbError(msg: string): string {
  if (msg.includes("uniq_niveis_codigo_por_tenant")) {
    return "Já existe um nível com esse código.";
  }
  if (msg.includes("chk_niveis_codigo_nao_vazio")) {
    return "Código do nível não pode ficar vazio.";
  }
  if (msg.includes("chk_niveis_ordem_positiva")) {
    return "Ordem precisa ser um inteiro positivo.";
  }
  return "Não foi possível salvar o nível.";
}

export async function criarNivel(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.niveis.editar");
  if (!gate.ok) return gate;

  const parsed = nivelSchema.safeParse({
    codigo: formData.get("codigo")?.toString() ?? "",
    descricao: formData.get("descricao")?.toString() ?? "",
    ordem: formData.get("ordem")?.toString() ?? "",
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
    .from("niveis")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo: parsed.data.codigo,
      descricao: parsed.data.descricao,
      ordem: parsed.data.ordem,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[niveis.criar]", error.message);
    return { ok: false, message: mapNivelDbError(error.message) };
  }

  await logAuditEvent({
    acao: "nivel.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "nivel",
    entidadeId: data.id,
    metadata: {
      codigo: parsed.data.codigo,
      descricao: parsed.data.descricao,
      ordem: parsed.data.ordem,
    },
  });

  revalidatePath("/rh/colaboradores/niveis");
  revalidatePath("/rh/colaboradores");
  return { ok: true, id: data.id };
}

export async function editarNivel(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.niveis.editar");
  if (!gate.ok) return gate;

  const parsed = nivelSchema.safeParse({
    codigo: formData.get("codigo")?.toString() ?? "",
    descricao: formData.get("descricao")?.toString() ?? "",
    ordem: formData.get("ordem")?.toString() ?? "",
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
    .from("niveis")
    .update({
      codigo: parsed.data.codigo,
      descricao: parsed.data.descricao,
      ordem: parsed.data.ordem,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[niveis.editar]", error.message);
    return { ok: false, message: mapNivelDbError(error.message) };
  }

  await logAuditEvent({
    acao: "nivel.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "nivel",
    entidadeId: id,
    metadata: {
      codigo: parsed.data.codigo,
      descricao: parsed.data.descricao,
      ordem: parsed.data.ordem,
    },
  });

  revalidatePath("/rh/colaboradores/niveis");
  revalidatePath("/rh/colaboradores");
  return { ok: true, id };
}

export async function inativarNivel(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.niveis.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("niveis")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[niveis.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar o nível." };
  }

  await logAuditEvent({
    acao: "nivel.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "nivel",
    entidadeId: id,
  });

  revalidatePath("/rh/colaboradores/niveis");
  revalidatePath("/rh/colaboradores");
  return { ok: true, id };
}

export async function reativarNivel(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.niveis.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("niveis")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[niveis.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar o nível." };
  }

  await logAuditEvent({
    acao: "nivel.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "nivel",
    entidadeId: id,
  });

  revalidatePath("/rh/colaboradores/niveis");
  revalidatePath("/rh/colaboradores");
  return { ok: true, id };
}
