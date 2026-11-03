"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { contratoSchema } from "@/lib/validations/freelancer-contratos";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function podeEscrever(role: string): boolean {
  return role === "administrador" || role === "rh" || role === "financeiro";
}

function parseForm(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  return contratoSchema.safeParse(raw);
}

/**
 * Snapshot do nome do job. Lê de `jobs` ou `freelancer_jobs_internos`
 * conforme a origem — devolve o nome ou null se o job não existe (ou foge do
 * tenant). O chamador decide se null é erro ou tolerável.
 */
async function nomeJobSnapshot(
  jobId: string,
  origem: "producao" | "interno",
  tenantId: string,
): Promise<string | null> {
  const supabase = createClient();
  const tabela = origem === "interno" ? "freelancer_jobs_internos" : "jobs";
  const { data, error } = await supabase
    .from(tabela)
    .select("nome")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { nome: string }).nome;
}

export async function criarFreelancerContrato(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para cadastrar contrato" };
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const origem = parsed.data.job_origem;
  if (!parsed.data.job_id) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: { job_id: ["Escolha um job"] },
    };
  }
  const nomeJob = await nomeJobSnapshot(
    parsed.data.job_id,
    origem,
    session.activeTenant.id,
  );
  if (!nomeJob) {
    return {
      ok: false,
      message: "Job não encontrado ou fora do seu tenant",
      fieldErrors: { job_id: ["Job inválido"] },
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancer_contratos")
    .insert({
      tenant_id: session.activeTenant.id,
      freelancer_id: parsed.data.freelancer_id,
      // Grava na coluna da fonte certa; a outra fica null (CHECK no banco
      // garante exclusividade).
      job_id: origem === "producao" ? parsed.data.job_id : null,
      job_interno_id: origem === "interno" ? parsed.data.job_id : null,
      responsavel_id: parsed.data.responsavel_id ?? null,
      nome_job: nomeJob,
      cargo: parsed.data.cargo ?? null,
      tipo: parsed.data.tipo,
      valor: parsed.data.valor,
      data_inicio: parsed.data.data_inicio ?? null,
      data_termino: parsed.data.data_termino ?? null,
      cidade: parsed.data.cidade ?? null,
      observacoes: parsed.data.observacoes ?? null,
      origem_sistema: "califa_erp",
      created_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[freelancer_contrato.criar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_contrato.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: data.id,
    metadata: {
      freelancer_id: parsed.data.freelancer_id,
      job_id: parsed.data.job_id,
      job_origem: origem,
      nome_job: nomeJob,
    },
  });

  revalidatePath(`/freelancers/${parsed.data.freelancer_id}`);
  revalidatePath("/freelancers/lista");
  redirect(`/freelancers/${parsed.data.freelancer_id}`);
}

export async function atualizarFreelancerContrato(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para editar contrato" };
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Lê o contrato pra decidir o que fazer com o job vazio:
  //   - novo (origem_sistema = califa_erp): job_id obrigatório
  //   - legado (origem_sistema = ag_california_rh): aceita vazio e mantém
  //     o nome_job atual (o legado não tem job vinculado no califa-erp)
  const { data: contratoExistente, error: readErr } = await supabase
    .from("freelancer_contratos")
    .select("origem_sistema, nome_job")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (readErr || !contratoExistente) {
    return { ok: false, message: "Contrato não encontrado" };
  }
  const ehLegado =
    (contratoExistente as { origem_sistema: string }).origem_sistema ===
    "ag_california_rh";

  const origem = parsed.data.job_origem;
  let nomeJob: string;
  if (parsed.data.job_id) {
    const snap = await nomeJobSnapshot(
      parsed.data.job_id,
      origem,
      session.activeTenant.id,
    );
    if (!snap) {
      return {
        ok: false,
        message: "Job não encontrado ou fora do seu tenant",
        fieldErrors: { job_id: ["Job inválido"] },
      };
    }
    nomeJob = snap;
  } else {
    if (!ehLegado) {
      return {
        ok: false,
        message: "Dados inválidos",
        fieldErrors: { job_id: ["Escolha um job"] },
      };
    }
    nomeJob = (contratoExistente as { nome_job: string }).nome_job;
  }

  const { error } = await supabase
    .from("freelancer_contratos")
    .update({
      freelancer_id: parsed.data.freelancer_id,
      // Em legado sem job escolhido, mantém as duas colunas como null (CHECK
      // do banco permite — o legado nasce assim).
      job_id:
        parsed.data.job_id && origem === "producao" ? parsed.data.job_id : null,
      job_interno_id:
        parsed.data.job_id && origem === "interno" ? parsed.data.job_id : null,
      responsavel_id: parsed.data.responsavel_id ?? null,
      nome_job: nomeJob,
      cargo: parsed.data.cargo ?? null,
      tipo: parsed.data.tipo,
      valor: parsed.data.valor,
      data_inicio: parsed.data.data_inicio ?? null,
      data_termino: parsed.data.data_termino ?? null,
      cidade: parsed.data.cidade ?? null,
      observacoes: parsed.data.observacoes ?? null,
      updated_by: session.profile.id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[freelancer_contrato.atualizar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_contrato.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: id,
    metadata: { nome_job: nomeJob, job_origem: origem },
  });

  revalidatePath(`/freelancers/${parsed.data.freelancer_id}`);
  revalidatePath("/freelancers/lista");
  revalidatePath(`/freelancers/contratos/${id}`);
  return { ok: true };
}
