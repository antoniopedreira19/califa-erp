"use server";

/**
 * Baixa em lote de fatura de cartão de crédito.
 *
 * Recebe N títulos mistos (parcelas de PP, avulsas, recorrências) e
 * despacha para a RPC `dar_baixa_lote_cartao`, que os baixa em uma única
 * transação. Falha em qualquer item aborta todos — a fatura é uma unidade.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Result = { ok: true; lancamentos: string[] } | { ok: false; message: string };

const tituloSchema = z.object({
  origem: z.enum(["avulso", "recorrencia"], {
    invalid_type_error: "Baixa em lote só aceita avulso e recorrência.",
  }),
  id: z.string().uuid("ID de título inválido."),
});

const baixaLoteSchema = z.object({
  cartao_credito_id: z.string().uuid("Selecione o cartão."),
  titulos: z.array(tituloSchema).min(1, "Selecione ao menos um título."),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária."),
  plano_conta_tipo_id: z.string().uuid("Selecione o tipo do plano de contas."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo do plano de contas."),
});

/**
 * Mapeia mensagens de constraint conhecidas para texto legível ao usuário.
 * Mesmo padrão de `mensagemDeBaixa` em `actions-titulos.ts`.
 */
function mensagemDeBaixaLote(msg: string): string {
  if (msg.includes("uniq_baixa_ativa_por_parcela")) {
    return "Um dos títulos (parcela de PP) já tem baixa registrada.";
  }
  if (msg.includes("uniq_baixa_ativa_por_avulsa")) {
    return "Um dos lançamentos avulsos já tem baixa registrada.";
  }
  if (msg.includes("uniq_baixa_ativa_por_pp_sem_parcela")) {
    return "Um dos pedidos de produção já tem baixa registrada.";
  }
  if (msg.includes("uniq_baixa_ativa_por_desembolso_parcela")) {
    return "Uma das parcelas de desembolso já tem baixa registrada.";
  }
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/[_"]/.test(limpa)) return limpa;
  return "Não foi possível dar baixa no lote. Tente novamente.";
}

/**
 * Dá baixa em lote nos títulos de uma fatura de cartão.
 *
 * Gate: admin | financeiro. Valida o tenant do cartão antes de chamar
 * a RPC. Grava 1 evento de auditoria agregado com todos os lançamentos
 * produzidos.
 */
export async function darBaixaLoteCartao(input: unknown): Promise<Result> {
  const parsed = baixaLoteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const session = await requireSession();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "cartao_credito",
      entidadeId: d.cartao_credito_id,
      metadata: {
        acao_tentada: "contas_pagar.baixa_lote_cartao",
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }

  const supabase = createClient();

  // Buscar nome do cartão para audit metadata e validar que pertence ao tenant.
  const { data: cartao, error: eCartao } = await supabase
    .from("cartoes_credito")
    .select("nome")
    .eq("id", d.cartao_credito_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (eCartao || !cartao) {
    return { ok: false, message: "Cartão não encontrado." };
  }

  const { data: ids, error } = await supabase.rpc("dar_baixa_lote_cartao", {
    p_titulos: d.titulos,
    p_pago_em: d.pago_em,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_plano_conta_tipo_id: d.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    p_criado_por: session.profile.id,
    p_cartao_credito_id: d.cartao_credito_id,
  });

  if (error) {
    console.error("[cartao.baixa_lote]", error.message);
    return { ok: false, message: mensagemDeBaixaLote(error.message) };
  }

  // Evento agregado — uma única entrada para a fatura toda.
  await logAuditEvent({
    acao: "contas_pagar.baixa_lote_cartao",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: d.cartao_credito_id,
    metadata: {
      cartao_nome: cartao.nome,
      quantidade_titulos: d.titulos.length,
      titulos: d.titulos,
      pago_em: d.pago_em,
      conta_bancaria_id: d.conta_bancaria_id,
      lancamentos: ids,
      forma_pagamento: "cartao_credito",
      cartao_credito_id: d.cartao_credito_id,
    },
  });

  // Eventos individuais — 1 por título, conforme spec §3.7.
  // Apenas avulso/recorrencia passam pela validação do schema.
  const avulsaIds = d.titulos.map((t) => t.id);

  // Batch SELECT para obter dados das contas avulsas.
  const avulsasMap = new Map<string, { descricao: string; valor: number }>();
  if (avulsaIds.length > 0) {
    const { data: avulsasData } = await supabase
      .from("contas_avulsas")
      .select("id, descricao, valor")
      .in("id", avulsaIds);
    for (const a of avulsasData ?? []) {
      avulsasMap.set(a.id, { descricao: a.descricao, valor: Number(a.valor) });
    }
  }

  // O array `ids` retornado pela RPC vem na mesma ordem de `d.titulos` — zipear.
  const lancamentosIds = (ids as string[]) ?? [];
  await Promise.all(
    d.titulos.map(async (titulo, idx) => {
      const lancamento_id = lancamentosIds[idx] ?? null;
      const avulsa = avulsasMap.get(titulo.id);
      await logAuditEvent({
        acao: "conta_avulsa.baixada",
        tenantId: session.activeTenant.id,
        entidadeTipo: "conta_avulsa",
        entidadeId: titulo.id,
        metadata: {
          descricao: avulsa?.descricao ?? null,
          lancamento_id,
          pago_em: d.pago_em,
          valor: avulsa?.valor ?? null,
          via: "baixa_lote_cartao",
          forma_pagamento: "cartao_credito",
          cartao_credito_id: d.cartao_credito_id,
        },
      });
    }),
  );

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro");

  return { ok: true, lancamentos: (ids as string[]) ?? [] };
}
