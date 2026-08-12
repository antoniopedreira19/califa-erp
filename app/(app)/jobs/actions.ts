"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { jobSchema, rejeicaoAberturaSchema } from "@/lib/validations/jobs";
import { JOB_STATUS_TRANSICOES, type JobStatus } from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

// `valor_total` e `faturamento_previsto` NÃO entram aqui de propósito: os
// dois são derivados dos itens orçados do job (ver `calcularTotaisVersao`)
// e só são reescritos pela abertura e pelas erratas. Já existiu um campo
// editável no drawer que gravava valor_total à mão — o JOB-0001 ficou com
// R$ 1.000.000 sobre R$ 5.617 de itens, e o card de Totais e a listagem
// passaram a contar histórias diferentes.
function extractInput(formData: FormData) {
  return {
    nome: formData.get("nome")?.toString() ?? "",
    produto: formData.get("produto")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    cidade: formData.get("cidade")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
    responsavel_id: formData.get("responsavel_id")?.toString() ?? "",
  };
}

function mapJobDbError(msg: string): string {
  if (msg.includes("uniq_jobs_codigo_por_tenant")) return "Já existe um job com este código.";
  if (msg.includes("uniq_jobs_por_orcamento_ativo")) return "Este orçamento já tem um job ativo.";
  if (msg.includes("jobs_datas_ordem")) return "Data fim precisa ser igual ou posterior à data início.";
  return "Não foi possível salvar o job.";
}

export async function atualizarJob(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = jobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Apenas campos operacionais são atualizáveis aqui — hierarquia e status têm actions próprias
  const { error } = await supabase
    .from("jobs")
    .update({
      nome: parsed.data.nome,
      produto: parsed.data.produto,
      regional_id: parsed.data.regional_id,
      cidade: parsed.data.cidade,
      data_inicio_prevista: parsed.data.data_inicio_prevista,
      data_fim_prevista: parsed.data.data_fim_prevista,
      responsavel_id: parsed.data.responsavel_id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.atualizar]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  return { ok: true, id };
}

export async function atualizarStatusJob(
  id: string,
  novoStatus: JobStatus,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  const transicoesValidas = JOB_STATUS_TRANSICOES[job.status];
  if (!transicoesValidas.includes(novoStatus)) {
    return {
      ok: false,
      message: `Transição inválida: ${job.status} → ${novoStatus}.`,
    };
  }

  const { error } = await supabase
    .from("jobs")
    .update({ status: novoStatus })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.status]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.status_alterado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
    metadata: { de: job.status, para: novoStatus },
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}`);
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id };
}

/**
 * Aprovar a abertura NÃO mora mais aqui.
 *
 * Abrir um job passou a exigir registro financeiro — categoria,
 * competência, custo previsto e curva de desembolso —, coletado no
 * formulário da Central Financeira. A action que grava tudo isso e só
 * então muda o status é `abrirJobNoFinanceiro`, em
 * app/(app)/financeiro/abertura-de-job/actions.ts. A antiga
 * `aprovarAberturaJob`, que só trocava o status, foi removida: mantida,
 * seria um caminho paralelo capaz de abrir job sem nenhum desses campos.
 */

export async function rejeitarAberturaJob(
  jobId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { action: "job.rejeitarAbertura", role: session.activeRole },
    });
    return { ok: false, message: "Só administrador ou financeiro pode rejeitar aberturas de job." };
  }

  const parsed = rejeicaoAberturaSchema.safeParse({
    motivo: formData.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Informe um motivo válido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: JobStatus; projeto_id: string; orcamento_id: string }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "aguardando_abertura") {
    return { ok: false, message: `Job está em status ${job.status} — não é rejeitável.` };
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      status: "rejeitado_financeiro",
      motivo_rejeicao: parsed.data.motivo,
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.rejeitarAbertura]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.abertura_rejeitada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id: jobId };
}

export async function reenviarJobParaAprovacao(jobId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: JobStatus; projeto_id: string; orcamento_id: string }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "rejeitado_financeiro") {
    return { ok: false, message: "Só jobs rejeitados podem ser reenviados." };
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      status: "aguardando_abertura",
      motivo_rejeicao: null,
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.reenviar]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.reenviado_para_aprovacao",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id: jobId };
}
