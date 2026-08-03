"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Ok = { ok: true };
type Err = { ok: false; message: string };
type Result = Ok | Err;

const motivoSchema = z
  .string()
  .trim()
  .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
  .max(500, "Motivo passa de 500 caracteres.");

const prazoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD.");

/**
 * Gate: apenas admin ou financeiro. Loga acao_negada caso contrário e retorna erro.
 */
async function checarGateFinanceiro(
  ppId: string,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: ppId,
      metadata: {
        acao_tentada: acaoTentada,
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }

  return { ok: true, session, supabase };
}

/**
 * Salva o prazo_pagamento_financeiro (data em que o financeiro vai pagar).
 * Aceita null pra limpar. Só permite se PP está 'emitida'.
 */
export async function salvarPrazoFinanceiro(
  pp_id: string,
  prazo: string | null,
): Promise<Result> {
  const gate = await checarGateFinanceiro(
    pp_id,
    "pedido_compra.prazo_financeiro_atualizado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Valida formato do prazo (aceita null)
  if (prazo !== null) {
    const parsed = prazoSchema.safeParse(prazo);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Prazo inválido." };
    }
  }

  // Load PP + valida tenant + status
  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select("id, status, job_id, codigo, prazo_pagamento_financeiro")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "emitida") {
    return {
      ok: false,
      message: "Prazo só pode ser ajustado em PP emitida.",
    };
  }

  const prazoAnterior = pp.prazo_pagamento_financeiro;

  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({ prazo_pagamento_financeiro: prazo })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao salvar prazo: ${updErr.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.prazo_financeiro_atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      prazo_anterior: prazoAnterior,
      prazo_novo: prazo,
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  return { ok: true };
}

/**
 * Cancela PP pelo financeiro. Motivo obrigatório (min 10 chars).
 * Soft delete: marca como cancelada, mantém PDF e anexos.
 * Zera fornecedor_id do realizado pra permitir nova PP.
 */
export async function cancelarPedidoCompraFinanceiro(
  pp_id: string,
  motivo: string,
): Promise<Result> {
  const gate = await checarGateFinanceiro(pp_id, "pedido_compra.cancelada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const motivoParsed = motivoSchema.safeParse(motivo);
  if (!motivoParsed.success) {
    return {
      ok: false,
      message: motivoParsed.error.issues[0]?.message ?? "Motivo inválido.",
    };
  }

  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select("id, status, job_id, codigo, item_realizado_id")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status === "cancelada") {
    return { ok: false, message: "PP já está cancelada." };
  }

  const agora = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "cancelada",
      cancelada_por: session.profile.id,
      cancelada_em: agora,
      motivo_cancelamento: motivoParsed.data,
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao cancelar PP: ${updErr.message}` };
  }

  // Zera fornecedor_id do realizado
  await supabase
    .from("jobs_itens_realizado")
    .update({ fornecedor_id: null })
    .eq("id", pp.item_realizado_id)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "pedido_compra.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      item_realizado_id: pp.item_realizado_id,
      job_id: pp.job_id,
      origem: "financeiro",
      motivo: motivoParsed.data,
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}
