"use server";

/**
 * O lado da produção do cancelamento de job aberto (decisão 169): pedir,
 * retirar o pedido, dispensar o aviso da recusa e cancelar, de dentro do
 * pop-up do pedido, as PPs que o travam.
 *
 * As regras moram no banco (`solicitar_cancelamento_do_job` e as outras
 * funções SECURITY DEFINER): papel, job aberto, um pedido por vez e as
 * travas. Aqui ficam o portão de permissão, a auditoria e o refresh das
 * telas. O financeiro decide em `financeiro/abertura-de-job/actions-cancelamento.ts`.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { cancelarPedidoCompra } from "./realizado/actions-pp";

export type ResultadoDoCancelamento = { ok: true } | { ok: false; message: string };

/** As telas que mostram o pedido. */
function revalidarTelas(job: { id: string; projeto_id: string; orcamento_id: string }) {
  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${job.id}`);
}

async function lerJob(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  jobId: string,
) {
  const { data } = await supabase
    .from("jobs")
    .select("id, codigo, status, projeto_id, orcamento_id")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      codigo: string;
      status: string;
      projeto_id: string;
      orcamento_id: string;
    }>();
  return data;
}

/** A mensagem que o banco levantou, sem o prefixo técnico. */
function mensagemDoBanco(erro: { message: string }): string {
  return erro.message.replace(/^.*?ERROR:\s*/, "").trim();
}

/** Pede o cancelamento do job aberto. O pedido vai à fila do financeiro. */
export async function solicitarCancelamentoDoJob(
  jobId: string,
  motivo: string,
): Promise<ResultadoDoCancelamento> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.solicitar_cancelamento");
  if (!gate.ok) return { ok: false, message: gate.message };

  const texto = motivo.trim();
  if (texto.length < 10) {
    return { ok: false, message: "Escreva o motivo do cancelamento com pelo menos 10 caracteres." };
  }
  if (texto.length > 500) {
    return { ok: false, message: "O motivo passa de 500 caracteres." };
  }

  const supabase = createClient();
  const job = await lerJob(supabase, session.activeTenant.id, jobId);
  if (!job) return { ok: false, message: "Job não encontrado." };

  const { data: id, error } = await supabase.rpc("solicitar_cancelamento_do_job", {
    p_job_id: jobId,
    p_motivo: texto,
  });
  if (error) {
    console.error("[cancelamento.solicitar]", error.message);
    return { ok: false, message: mensagemDoBanco(error) };
  }

  await logAuditEvent({
    acao: "job.cancelamento_solicitado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: job.id,
    metadata: { codigo: job.codigo, cancelamento_id: id, motivo: texto, decisao: "169" },
  });

  revalidarTelas(job);
  return { ok: true };
}

/** A produção desiste do pedido antes da decisão: o job volta ao normal. */
export async function retirarPedidoDeCancelamento(
  cancelamentoId: string,
): Promise<ResultadoDoCancelamento> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.solicitar_cancelamento");
  if (!gate.ok) return { ok: false, message: gate.message };

  const supabase = createClient();
  const { data: pedido } = await supabase
    .from("jobs_cancelamentos")
    .select("id, job_id")
    .eq("id", cancelamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; job_id: string }>();
  if (!pedido) return { ok: false, message: "Pedido de cancelamento não encontrado." };

  const { error } = await supabase.rpc("retirar_cancelamento_do_job", {
    p_cancelamento_id: cancelamentoId,
  });
  if (error) {
    console.error("[cancelamento.retirar]", error.message);
    return { ok: false, message: mensagemDoBanco(error) };
  }

  const job = await lerJob(supabase, session.activeTenant.id, pedido.job_id);
  await logAuditEvent({
    acao: "job.cancelamento_retirado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: pedido.job_id,
    metadata: { codigo: job?.codigo ?? null, cancelamento_id: cancelamentoId, decisao: "169" },
  });

  if (job) revalidarTelas(job);
  return { ok: true };
}

/** A produção leu a recusa do financeiro: a faixa sai da página do job. */
export async function dispensarRecusaDoCancelamento(
  cancelamentoId: string,
): Promise<ResultadoDoCancelamento> {
  const session = await requireSession();
  const supabase = createClient();
  const { data: pedido } = await supabase
    .from("jobs_cancelamentos")
    .select("id, job_id")
    .eq("id", cancelamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; job_id: string }>();
  if (!pedido) return { ok: false, message: "Pedido de cancelamento não encontrado." };

  const { error } = await supabase.rpc("dispensar_recusa_do_cancelamento", {
    p_cancelamento_id: cancelamentoId,
  });
  if (error) {
    console.error("[cancelamento.dispensar]", error.message);
    return { ok: false, message: mensagemDoBanco(error) };
  }
  revalidatePath(`/jobs/${pedido.job_id}`);
  return { ok: true };
}

/**
 * As PPs que travam o pedido, canceladas de dentro do pop-up dele — o
 * padrão da decisão 143. Cada PP passa por `cancelarPedidoCompra`, com as
 * regras, as permissões e a auditoria de sempre: PP aprovada ou paga não
 * se cancela por aqui (o pop-up nem oferece).
 *
 * `ppIds` é a lista que a pessoa viu e confirmou; se as PPs canceláveis do
 * job mudaram desde então, nada é cancelado.
 */
export async function cancelarPPsDoPedidoDeCancelamento(
  jobId: string,
  ppIds: string[],
): Promise<ResultadoDoCancelamento> {
  const session = await requireSession();
  const gatePedido = await checarPermissao(session, "jobs.solicitar_cancelamento");
  if (!gatePedido.ok) return { ok: false, message: gatePedido.message };
  const gatePP = await checarPermissao(session, "jobs.cancelar_pp");
  if (!gatePP.ok) return { ok: false, message: gatePP.message };

  const supabase = createClient();
  const job = await lerJob(supabase, session.activeTenant.id, jobId);
  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "aberto" && job.status !== "em_producao") {
    return { ok: false, message: "Só job aberto tem pedido de cancelamento." };
  }

  const { data: pps, error: errPps } = await supabase
    .from("pedidos_compra")
    .select("id, codigo")
    .eq("job_id", job.id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["gerada", "em_avaliacao", "rejeitada"])
    .order("codigo", { ascending: true })
    .returns<{ id: string; codigo: string }[]>();
  if (errPps) {
    console.error("[cancelamento.pps.select]", errPps.message);
    return { ok: false, message: "Não foi possível ler as PPs do job." };
  }

  const atuais = pps ?? [];
  const confirmadas = new Set(ppIds);
  const mesmaLista =
    atuais.length === confirmadas.size && atuais.every((pp) => confirmadas.has(pp.id));
  if (!mesmaLista) {
    return {
      ok: false,
      message:
        "As PPs do job mudaram desde que o pop-up abriu, e nenhuma foi cancelada. Confira a lista atualizada e confirme de novo.",
    };
  }
  if (atuais.length === 0) return { ok: true };

  const canceladas: string[] = [];
  const falhas: string[] = [];
  for (const pp of atuais) {
    const res = await cancelarPedidoCompra(pp.id);
    if (res.ok) canceladas.push(pp.codigo);
    else falhas.push(`${pp.codigo}: ${res.message}`);
  }

  if (canceladas.length > 0) {
    await logAuditEvent({
      acao: "job.pps_canceladas_no_pedido_de_cancelamento",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: job.id,
      metadata: { codigo: job.codigo, pps: canceladas, decisao: "169" },
    });
  }

  revalidatePath(`/jobs/${job.id}`);

  if (falhas.length > 0) {
    return {
      ok: false,
      message:
        canceladas.length > 0
          ? `Canceladas: ${canceladas.join(", ")}. Não canceladas — ${falhas.join("; ")}`
          : `Nenhuma PP foi cancelada — ${falhas.join("; ")}`,
    };
  }
  return { ok: true };
}
