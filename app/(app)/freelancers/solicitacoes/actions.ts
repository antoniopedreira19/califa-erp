"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarSolicitacaoSchema,
  rejeitarSolicitacaoSchema,
} from "@/lib/validations/freelancer-solicitacoes";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

function parseForm(formData: FormData, schema: any) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  return schema.safeParse(raw);
}

export async function criarSolicitacao(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();

  const parsed = parseForm(formData, criarSolicitacaoSchema);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancer_solicitacoes")
    .insert({
      tenant_id: session.activeTenant.id,
      solicitante_id: session.profile.id,
      nome_freela: parsed.data.nome_freela,
      cpf_freela: parsed.data.cpf_freela ?? null,
      job_id: parsed.data.job_id,
      cargo: parsed.data.cargo ?? null,
      tipo: parsed.data.tipo,
      valor: parsed.data.valor,
      data_inicio: parsed.data.data_inicio ?? null,
      data_termino: parsed.data.data_termino ?? null,
      cidade: parsed.data.cidade ?? null,
      observacoes: parsed.data.observacoes ?? null,
      status: "pendente",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[solicitacao.criar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: data.id,
    metadata: { nome_freela: parsed.data.nome_freela },
  });

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true, data: { id: data.id } };
}

export async function aprovarSolicitacao(
  id: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!APROVADORES.has(session.activeRole)) {
    return { ok: false, message: "Sem permissão para aprovar" };
  }

  const supabase = createClient();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { error } = await supabase
    .from("freelancer_solicitacoes")
    .update({
      status: "aprovada",
      aprovado_por: session.profile.id,
      aprovado_em: agora.toISOString(),
      expira_em: expiraEm.toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "pendente");

  if (error) {
    console.error("[solicitacao.aprovar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: id,
  });

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true };
}

export async function rejeitarSolicitacao(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!APROVADORES.has(session.activeRole)) {
    return { ok: false, message: "Sem permissão para rejeitar" };
  }

  const parsed = parseForm(formData, rejeitarSolicitacaoSchema);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Motivo inválido",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancer_solicitacoes")
    .update({
      status: "rejeitada",
      rejeitado_por: session.profile.id,
      rejeitado_em: new Date().toISOString(),
      rejeicao_motivo: parsed.data.motivo,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "pendente");

  if (error) {
    console.error("[solicitacao.rejeitar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.rejeitada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: id,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true };
}

export async function cancelarSolicitacao(
  id: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // RLS garante que o user pode mesmo cancelar (solicitante ou admin/rh/fin)
  const { error } = await supabase
    .from("freelancer_solicitacoes")
    .update({
      status: "cancelada",
      cancelado_por: session.profile.id,
      cancelado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["pendente", "aprovada"]);

  if (error) {
    console.error("[solicitacao.cancelar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: id,
  });

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true };
}
