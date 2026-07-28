"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { projetoSchema } from "@/lib/validations/projetos";
import { gerarCodigoProjeto } from "@/lib/codigos/projetos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    nome: formData.get("nome")?.toString() ?? "",
    campanha: formData.get("campanha")?.toString() ?? "",
    cliente_id: formData.get("cliente_id")?.toString() ?? "",
    responsavel_id: formData.get("responsavel_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    categoria_id: formData.get("categoria_id")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_projetos_codigo_por_tenant")) {
    return "Já existe um projeto com este código — tente novamente.";
  }
  if (msg.includes("projetos_cliente_id_fkey")) {
    return "Cliente inválido.";
  }
  if (msg.includes("projetos_responsavel_id_fkey")) {
    return "Responsável inválido.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

export async function criarProjeto(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = projetoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  let codigo: string;
  try {
    codigo = await gerarCodigoProjeto(
      supabase,
      session.activeTenant.id,
      parsed.data.cliente_id,
      parsed.data.data_inicio_prevista,
    );
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { data, error } = await supabase
    .from("projetos")
    .insert({
      ...parsed.data,
      codigo,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[projetos.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "projeto.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: data.id,
    metadata: { codigo, nome: parsed.data.nome, cliente_id: parsed.data.cliente_id },
  });

  revalidatePath("/orcamentos");
  redirect(`/orcamentos/${data.id}`);
}

export async function atualizarProjeto(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = projetoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Confirma que o projeto pertence ao tenant do usuário (RLS já filtra,
  // mas explicitamos no where pra clareza).
  const { error } = await supabase
    .from("projetos")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "projeto.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}

export async function arquivarProjeto(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // Bloqueia se houver orçamento não-cancelado no projeto.
  const { count, error: errCount } = await supabase
    .from("orcamentos")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if (errCount) {
    console.error("[projetos.arquivar.count]", errCount.message);
    return { ok: false, message: "Falha ao verificar orçamentos do projeto." };
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: "Cancele todos os orçamentos do projeto antes de arquivar.",
    };
  }

  const { error } = await supabase
    .from("projetos")
    .update({ status: "arquivado" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.arquivar]", error.message);
    return { ok: false, message: "Não foi possível arquivar." };
  }

  await logAuditEvent({
    acao: "projeto.arquivado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}

export async function reativarProjeto(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("projetos")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "projeto.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}
