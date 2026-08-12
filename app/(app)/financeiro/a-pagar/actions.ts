"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Ok = { ok: true };
type Err = { ok: false; message: string };
type Result = Ok | Err;

async function checarGateFinanceiro(
  entidadeId: string,
  entidadeTipo: string,
  acaoTentada: string,
): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase };
}

const baixaPPSchema = z.object({
  pp_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
});

/**
 * Baixa uma PP aprovada via RPC. PP em em_avaliacao também aceita por ora
 * (Task 11 endurece pra exigir status 'aprovada' na RPC).
 */
export async function marcarPagaFinanceiro(input: unknown): Promise<Result> {
  const parsed = baixaPPSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.pp_id, "pedido_compra", "pedido_compra.paga");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, valor, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "aprovada" && pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message: pp.status === "pago" ? "PP já está paga." : "Só PP aprovada pode ser baixada.",
    };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_pp", {
    p_pp_id: parsed.data.pp_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
    p_criado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "pedido_compra.paga",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      pago_em: parsed.data.pago_em,
      job_id: pp.job_id,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidatePath("/financeiro/a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

const baixaAvulsaSchema = z.object({
  avulsa_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

export async function darBaixaAvulsa(input: unknown): Promise<Result> {
  const parsed = baixaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.avulsa_id, "conta_avulsa", "conta_avulsa.baixada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: av } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor")
    .eq("id", parsed.data.avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!av) return { ok: false, message: "Conta avulsa não encontrada." };
  if (av.status !== "aprovada" && av.status !== "pendente") {
    return {
      ok: false,
      message: av.status === "baixada" ? "Já está baixada." : "Só avulsa aprovada pode ser baixada.",
    };
  }

  // RPC usa p_conta_avulsa_id (não p_avulsa_id) e deriva criado_por de auth.uid()
  const { data: lancId, error } = await supabase.rpc("dar_baixa_avulsa", {
    p_conta_avulsa_id: parsed.data.avulsa_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.baixada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: parsed.data.avulsa_id,
    metadata: {
      descricao: av.descricao,
      valor: Number(av.valor),
      pago_em: parsed.data.pago_em,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidatePath("/financeiro/a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true };
}
