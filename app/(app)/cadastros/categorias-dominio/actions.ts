"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import { categoriaDominioSchema } from "@/lib/validations/categorias-dominio";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapDbError(msg: string): string {
  if (msg.includes("uniq_categoria_dominio_por_escopo_tenant")) {
    return "Já existe uma categoria com esse nome nesse escopo.";
  }
  if (msg.includes("categorias_dominio_nome_nao_vazio")) {
    return "Nome não pode ficar vazio.";
  }
  return "Não foi possível salvar a categoria.";
}

export async function criarCategoriaDominio(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;
  const parsed = categoriaDominioSchema.safeParse({
    escopo: formData.get("escopo")?.toString() ?? "",
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
    .from("categorias_dominio")
    .insert({
      tenant_id: session.activeTenant.id,
      escopo: parsed.data.escopo,
      nome: parsed.data.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[categorias_dominio.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "categoria_dominio.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria_dominio",
    entidadeId: data.id,
    metadata: { escopo: parsed.data.escopo, nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/categorias-dominio");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function editarCategoriaDominio(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;
  const parsed = categoriaDominioSchema.safeParse({
    escopo: formData.get("escopo")?.toString() ?? "",
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
    .from("categorias_dominio")
    .update({ escopo: parsed.data.escopo, nome: parsed.data.nome })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias_dominio.editar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "categoria_dominio.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria_dominio",
    entidadeId: id,
    metadata: { escopo: parsed.data.escopo, nome: parsed.data.nome },
  });

  revalidatePath("/cadastros/categorias-dominio");
  return { ok: true, id };
}

export async function inativarCategoriaDominio(
  id: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("categorias_dominio")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias_dominio.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "categoria_dominio.inativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria_dominio",
    entidadeId: id,
  });

  revalidatePath("/cadastros/categorias-dominio");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarCategoriaDominio(
  id: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(
    session,
    "cadastros.categorias_orcamento.editar",
  );
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("categorias_dominio")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias_dominio.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "categoria_dominio.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "categoria_dominio",
    entidadeId: id,
  });

  revalidatePath("/cadastros/categorias-dominio");
  revalidatePath("/cadastros");
  return { ok: true, id };
}
