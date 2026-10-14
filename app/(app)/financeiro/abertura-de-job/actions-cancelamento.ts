"use server";

/**
 * O lado do financeiro do cancelamento de job aberto (decisão 169): aprovar
 * ou recusar o pedido da produção, da fila da Abertura de Job.
 *
 * A aprovação é uma função só do banco (`aprovar_cancelamento_do_job`):
 * confere de novo as travas, leva o job a `cancelado`, fecha a revisão da
 * abertura se houver, inativa o projeto financeiro que fica sem job vivo e
 * guarda a foto do que saiu das contas. As previsões da abertura ficam
 * gravadas — o fluxo de caixa e a rentabilidade já ignoram job cancelado.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";

export type ResultadoDaDecisao = { ok: true } | { ok: false; message: string };

async function lerPedido(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  cancelamentoId: string,
) {
  const { data } = await supabase
    .from("jobs_cancelamentos")
    .select("id, job_id, motivo, job:jobs!inner(id, codigo, projeto_id, orcamento_id)")
    .eq("id", cancelamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      job_id: string;
      motivo: string;
      job: { id: string; codigo: string; projeto_id: string; orcamento_id: string };
    }>();
  return data;
}

function revalidarTelas(job: { id: string; projeto_id: string; orcamento_id: string }) {
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${job.id}`);
  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  revalidatePath(`/orcamentos/${job.projeto_id}`);
}

/** Aprova: o job é cancelado e sai do módulo de Jobs (decisão 163). */
export async function aprovarCancelamentoDoJob(
  cancelamentoId: string,
  observacao: string,
): Promise<ResultadoDaDecisao> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.decidir_cancelamento");
  if (!gate.ok) return { ok: false, message: gate.message };

  const texto = observacao.trim();
  if (texto.length > 500) {
    return { ok: false, message: "A observação passa de 500 caracteres." };
  }

  const supabase = createClient();
  const pedido = await lerPedido(supabase, session.activeTenant.id, cancelamentoId);
  if (!pedido) return { ok: false, message: "Pedido de cancelamento não encontrado." };

  const { data, error } = await supabase.rpc("aprovar_cancelamento_do_job", {
    p_cancelamento_id: cancelamentoId,
    p_observacao: texto,
  });
  if (error) {
    console.error("[cancelamento.aprovar]", error.message);
    return { ok: false, message: error.message };
  }

  const foto = (data ?? {}) as {
    recebimento_previsto?: number;
    custo_previsto?: number;
    impostos_previstos?: number;
    projeto_financeiro_inativado?: string | null;
  };
  await logAuditEvent({
    acao: "job.cancelado_apos_abertura",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: pedido.job_id,
    metadata: {
      codigo: pedido.job.codigo,
      cancelamento_id: cancelamentoId,
      motivo: pedido.motivo,
      observacao: texto || null,
      recebimento_previsto: foto.recebimento_previsto ?? null,
      custo_previsto: foto.custo_previsto ?? null,
      impostos_previstos: foto.impostos_previstos ?? null,
      projeto_financeiro_inativado: foto.projeto_financeiro_inativado ?? null,
      decisao: "169",
    },
  });

  revalidarTelas(pedido.job);
  return { ok: true };
}

/** Recusa: o job volta ao normal, e a justificativa vai à página dele. */
export async function recusarCancelamentoDoJob(
  cancelamentoId: string,
  justificativa: string,
): Promise<ResultadoDaDecisao> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.decidir_cancelamento");
  if (!gate.ok) return { ok: false, message: gate.message };

  const texto = justificativa.trim();
  if (texto.length < 10) {
    return { ok: false, message: "Escreva a justificativa com pelo menos 10 caracteres." };
  }
  if (texto.length > 500) {
    return { ok: false, message: "A justificativa passa de 500 caracteres." };
  }

  const supabase = createClient();
  const pedido = await lerPedido(supabase, session.activeTenant.id, cancelamentoId);
  if (!pedido) return { ok: false, message: "Pedido de cancelamento não encontrado." };

  const { error } = await supabase.rpc("recusar_cancelamento_do_job", {
    p_cancelamento_id: cancelamentoId,
    p_justificativa: texto,
  });
  if (error) {
    console.error("[cancelamento.recusar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "job.cancelamento_recusado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: pedido.job_id,
    metadata: {
      codigo: pedido.job.codigo,
      cancelamento_id: cancelamentoId,
      justificativa: texto,
      decisao: "169",
    },
  });

  revalidarTelas(pedido.job);
  return { ok: true };
}
