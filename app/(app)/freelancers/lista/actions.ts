"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarCargoSchema,
  renomearCargoSchema,
  toggleCargoAtivoSchema,
} from "@/lib/validations/freelancer-cargos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Admin e RH podem gerenciar o catálogo de cargos. GP, produtor,
 * financeiro e freelancer não podem — alinhado com a policy do banco.
 */
function podeGerenciarCargos(role: string): boolean {
  return role === "administrador" || role === "rh";
}

export async function criarCargo(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeGerenciarCargos(session.activeRole)) {
    return { ok: false, message: "Sem permissão para gerenciar cargos" };
  }

  const parsed = criarCargoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancer_cargos")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: parsed.data.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: "Já existe um cargo com esse nome",
        fieldErrors: { nome: ["Nome já em uso"] },
      };
    }
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_cargo.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_cargo",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath("/freelancers/lista");
  return { ok: true, id: data.id };
}

export async function renomearCargo(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeGerenciarCargos(session.activeRole)) {
    return { ok: false, message: "Sem permissão para gerenciar cargos" };
  }

  const parsed = renomearCargoSchema.safeParse({
    id: formData.get("id")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancer_cargos")
    .update({ nome: parsed.data.nome })
    .eq("id", parsed.data.id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: "Já existe um cargo com esse nome",
        fieldErrors: { nome: ["Nome já em uso"] },
      };
    }
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_cargo.renomeado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_cargo",
    entidadeId: parsed.data.id,
    metadata: { nome_novo: parsed.data.nome },
  });

  revalidatePath("/freelancers/lista");
  return { ok: true };
}

export async function toggleCargoAtivo(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeGerenciarCargos(session.activeRole)) {
    return { ok: false, message: "Sem permissão para gerenciar cargos" };
  }

  const parsed = toggleCargoAtivoSchema.safeParse({
    id: formData.get("id")?.toString() ?? "",
    ativo: formData.get("ativo")?.toString() === "true",
  });
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos" };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancer_cargos")
    .update({ ativo: parsed.data.ativo })
    .eq("id", parsed.data.id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: parsed.data.ativo
      ? "freelancer_cargo.reativado"
      : "freelancer_cargo.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_cargo",
    entidadeId: parsed.data.id,
  });

  revalidatePath("/freelancers/lista");
  return { ok: true };
}
