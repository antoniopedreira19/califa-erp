"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import { categoriaSchema } from "@/lib/validations/categorias";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapCategoriaDbError(msg: string): string {
  if (msg.includes("uniq_categoria_nome_por_tenant")) {
    return "Já existe uma categoria com esse nome.";
  }
  if (msg.includes("categorias_nome_nao_vazio")) {
    return "Nome da categoria não pode ficar vazio.";
  }
  return "Não foi possível salvar a categoria.";
}

export async function criarCategoria(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;
  const parsed = categoriaSchema.safeParse({
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
    .from("categorias")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: parsed.data.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[categorias.criar]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  await logAuditEvent({
    acao: "categoria.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/categorias");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function editarCategoria(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;
  const parsed = categoriaSchema.safeParse({
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
    .from("categorias")
    .update({ nome: parsed.data.nome })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.editar]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  await logAuditEvent({
    acao: "categoria.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/categorias");
  return { ok: true, id };
}

export async function inativarCategoria(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("categorias")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "categoria.inativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: id,
  });

  revalidatePath("/categorias");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarCategoria(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("categorias")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "categoria.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria",
    entidadeId: id,
  });

  revalidatePath("/categorias");
  revalidatePath("/cadastros");
  return { ok: true, id };
}
