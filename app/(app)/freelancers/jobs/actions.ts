"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  arquivarJobInternoSchema,
  criarJobInternoSchema,
  editarJobInternoSchema,
} from "@/lib/validations/freelancer-jobs-internos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Admin, RH e Financeiro podem criar/editar/arquivar job interno. GP e
 * produtor leem via RLS mas não escrevem — alinhado com a policy do banco.
 */
function podeEscrever(role: string): boolean {
  return role === "administrador" || role === "rh" || role === "financeiro";
}

export async function criarJobInterno(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para criar job interno" };
  }

  const parsed = criarJobInternoSchema.safeParse({
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    descricao: formData.get("descricao")?.toString() ?? "",
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
    .from("freelancer_jobs_internos")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo: parsed.data.codigo,
      nome: parsed.data.nome,
      descricao: parsed.data.descricao,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: "Já existe um job interno com esse código",
        fieldErrors: { codigo: ["Código já em uso"] },
      };
    }
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_job_interno.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_job_interno",
    entidadeId: data.id,
    metadata: { codigo: parsed.data.codigo, nome: parsed.data.nome },
  });

  revalidatePath("/freelancers/jobs");
  return { ok: true, id: data.id };
}

export async function editarJobInterno(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para editar job interno" };
  }

  const parsed = editarJobInternoSchema.safeParse({
    id: formData.get("id")?.toString() ?? "",
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    descricao: formData.get("descricao")?.toString() ?? "",
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
    .from("freelancer_jobs_internos")
    .update({
      codigo: parsed.data.codigo,
      nome: parsed.data.nome,
      descricao: parsed.data.descricao,
      updated_by: session.profile.id,
    })
    .eq("id", parsed.data.id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: "Já existe um job interno com esse código",
        fieldErrors: { codigo: ["Código já em uso"] },
      };
    }
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_job_interno.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_job_interno",
    entidadeId: parsed.data.id,
    metadata: { codigo: parsed.data.codigo, nome: parsed.data.nome },
  });

  revalidatePath("/freelancers/jobs");
  return { ok: true };
}

export async function arquivarJobInterno(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para arquivar job interno" };
  }

  const parsed = arquivarJobInternoSchema.safeParse({
    id: formData.get("id")?.toString() ?? "",
    arquivar: formData.get("arquivar")?.toString() === "true",
  });
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos" };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancer_jobs_internos")
    .update(
      parsed.data.arquivar
        ? {
            arquivado_em: new Date().toISOString(),
            arquivado_por: session.profile.id,
            updated_by: session.profile.id,
          }
        : {
            arquivado_em: null,
            arquivado_por: null,
            updated_by: session.profile.id,
          },
    )
    .eq("id", parsed.data.id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: parsed.data.arquivar
      ? "freelancer_job_interno.arquivado"
      : "freelancer_job_interno.desarquivado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_job_interno",
    entidadeId: parsed.data.id,
  });

  revalidatePath("/freelancers/jobs");
  return { ok: true };
}
