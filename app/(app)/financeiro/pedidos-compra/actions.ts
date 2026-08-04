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
 * Salva o prazo_pagamento_financeiro (data em que o financeiro pretende
 * pagar — não confundir com `pago_em`, a data em que o pagamento saiu).
 * Aceita null pra limpar. Só permite enquanto a PP está em avaliação.
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
  if (pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message: "Prazo só pode ser ajustado em PP que está em avaliação.",
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
 * Marca a PP como paga. A data vem do financeiro e pode ser retroativa —
 * é comum lançar dias depois do pagamento sair.
 *
 * Por enquanto é só uma marcação de status. Contas a pagar de verdade
 * (`lancamentos_financeiros`, estorno) fica pra uma fase futura e vai
 * partir daqui.
 */
export async function marcarPagaFinanceiro(
  pp_id: string,
  pagoEm: string,
): Promise<Result> {
  const gate = await checarGateFinanceiro(pp_id, "pedido_compra.paga");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const dataParsed = prazoSchema.safeParse(pagoEm);
  if (!dataParsed.success) {
    return {
      ok: false,
      message: dataParsed.error.issues[0]?.message ?? "Data inválida.",
    };
  }

  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select("id, status, job_id, codigo, valor")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message:
        pp.status === "pago"
          ? "PP já está paga."
          : "Só PP em avaliação pode ser marcada como paga.",
    };
  }

  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "pago",
      pago_em: dataParsed.data,
      pago_por: session.profile.id,
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao marcar como paga: ${updErr.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.paga",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      pago_em: dataParsed.data,
      job_id: pp.job_id,
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

/**
 * Rejeita a PP com motivo obrigatório. Não é cancelamento: a PP continua
 * ocupando o item, e o GP corrige e reenvia pela aba de PPs do job.
 */
export async function rejeitarPedidoCompraFinanceiro(
  pp_id: string,
  motivo: string,
): Promise<Result> {
  const gate = await checarGateFinanceiro(pp_id, "pedido_compra.rejeitada");
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
    .select("id, status, job_id, codigo")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message:
        pp.status === "rejeitada"
          ? "PP já está rejeitada."
          : "Só PP em avaliação pode ser rejeitada.",
    };
  }

  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "rejeitada",
      rejeitada_por: session.profile.id,
      rejeitada_em: new Date().toISOString(),
      motivo_rejeicao: motivoParsed.data,
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao rejeitar PP: ${updErr.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.rejeitada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      job_id: pp.job_id,
      motivo: motivoParsed.data,
    },
  });

  revalidatePath("/financeiro/pedidos-compra");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}
