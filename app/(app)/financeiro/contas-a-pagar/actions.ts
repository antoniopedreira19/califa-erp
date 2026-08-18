"use server";

/**
 * Ações do financeiro sobre o Pedido de Produção.
 *
 * ⚠️ Nota da Tela 3.2 (17/08/2026): quatro exports deste arquivo ficaram
 * SEM CHAMADOR na UI, e é de propósito:
 *
 * • `aprovarPP` e `salvarPrazoFinanceiro` — a aprovação passou a exigir a
 *   data de pagamento no mesmo ato (`aprovarPPComData`, em
 *   `actions-titulos.ts`), o que dispensou o par "salvar prazo" +
 *   "aprovar".
 * • `marcarPagaFinanceiro` e `darBaixaAvulsaInline` — a baixa deixou de
 *   ser da PP inteira e da avulsa isolada; agora é do TÍTULO (parcela ou
 *   avulsa), em `darBaixaTitulo`.
 *
 * ⚠️ Atualização de 18/08/2026: `estornarBaixaPP` SAIU deste arquivo.
 * O estorno passou a ser por PARCELA (decisão do Tiago), e mora em
 * `estornarBaixaParcela`, em `actions-titulos.ts`, ao lado da baixa que
 * ele reverte.
 *
 * `rejeitarPedidoCompraFinanceiro` e `desaprovarPP` seguem em uso.
 */

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

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

const baixaPPSchema = z.object({
  pp_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo."),
});

/**
 * Baixa uma PP aprovada via RPC. Exige status='aprovada' (Task 11).
 */
export async function marcarPagaFinanceiro(input: unknown): Promise<Result> {
  const parsed = baixaPPSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.pp_id, "pedido_compra.paga");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, valor, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "aprovada") {
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

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

const baixaAvulsaFinanceiroSchema = z.object({
  avulsa_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
});

/**
 * Baixa uma conta avulsa aprovada via RPC dar_baixa_avulsa.
 * (Existe também darBaixaAvulsa em actions-avulsas.ts pra a tela de detalhe;
 * esta versão serve a listagem inline em contas-a-pagar.)
 */
export async function darBaixaAvulsaInline(input: unknown): Promise<Result> {
  const parsed = baixaAvulsaFinanceiroSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.avulsa_id, "conta_avulsa.baixada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: av } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor")
    .eq("id", parsed.data.avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!av) return { ok: false, message: "Conta avulsa não encontrada." };
  if (av.status !== "aprovada") {
    return {
      ok: false,
      message: av.status === "baixada" ? "Já está baixada." : "Só avulsa aprovada pode ser baixada.",
    };
  }

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

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true };
}

/**
 * ⚠️ `estornarBaixaPP` foi REMOVIDA em 18/08/2026.
 *
 * Ela estornava a PP INTEIRA, num tempo em que uma PP tinha uma baixa
 * só. Desde a decisão 016 a baixa é por PARCELA, e o Tiago fechou a
 * simetria: "cada baixa ou estorno deverá ser feito por parcela; a
 * aprovação é por PP". Manter a versão antiga exposta era um risco real
 * — ela devolvia a PP a `aprovada` sem limpar `pago_em` das parcelas.
 *
 * A substituta é `estornarBaixaParcela`, em `actions-titulos.ts`, ao
 * lado da baixa que ela reverte. A RPC `estornar_baixa_pp` continua no
 * banco, desarmada, levantando exceção com o caminho novo
 * (`20260818000002_estorno_por_parcela.sql`).
 */

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

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

/**
 * Aprova a PP: muda em_avaliacao -> aprovada. A partir daí, a PP entra
 * na fila "A pagar" e pode ser efetivamente baixada.
 */
export async function aprovarPP(pp_id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(pp_id, "pedido_compra.aprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, valor, job_id, prazo_pagamento_financeiro")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message:
        pp.status === "aprovada"
          ? "PP já está aprovada."
          : "Só PP em avaliação pode ser aprovada.",
    };
  }

  // A data de pagamento é o que a aprovação decide (decisão 016): ela
  // vira o vencimento do título em Títulos a Pagar e desloca as demais
  // parcelas pelo mesmo número de dias. Sem ela o título nasceria sem
  // data e sem 1ª data registrada, quebrando a repactuação. A trava
  // existe também na RPC — esta aqui é para a mensagem chegar em
  // português (18/08/2026).
  if (!pp.prazo_pagamento_financeiro) {
    return {
      ok: false,
      message: "Escolha a data de pagamento antes de aprovar a PP.",
    };
  }

  const { error } = await supabase.rpc("aprovar_pp", { p_pp_id: pp_id });
  if (error) {
    return { ok: false, message: `Falha ao aprovar: ${error.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      job_id: pp.job_id,
      prazo_pagamento_financeiro: pp.prazo_pagamento_financeiro,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

const desaprovarSchema = z.object({
  pp_id: z.string().uuid(),
  motivo: motivoSchema,
});

/**
 * Desaprova a PP: devolve pra em_avaliacao. Usado quando a aprovação foi
 * feita por engano ou apareceu informação nova que exige reavaliação.
 */
export async function desaprovarPP(input: unknown): Promise<Result> {
  const parsed = desaprovarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(parsed.data.pp_id, "pedido_compra.desaprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "aprovada") {
    return { ok: false, message: "Só PP aprovada pode ser desaprovada." };
  }

  const { error } = await supabase.rpc("desaprovar_pp", {
    p_pp_id: parsed.data.pp_id,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    return { ok: false, message: `Falha ao desaprovar: ${error.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.desaprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      job_id: pp.job_id,
      motivo: parsed.data.motivo,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}
