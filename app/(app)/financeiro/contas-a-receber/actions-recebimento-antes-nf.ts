"use server";

/**
 * Recebimento antes da NF (decisão 130).
 *
 * O cliente pagou e a nota ainda não saiu. O financeiro registra o
 * recebimento na linha da aba Faturamento — a nota do envio ou o BV — e o
 * dinheiro entra no extrato na hora. Quando a NF daquela linha é emitida,
 * `emitir_faturamento` transforma o recebimento na parcela 1 dela, já
 * quitada.
 *
 * As regras moram nas duas funções do banco (saldo, papel, conta, centro
 * de custo, auditoria); aqui fica o schema e a tradução do erro.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Result = { ok: true } | { ok: false; message: string };

async function gateFinanceiro(acaoTentada: string) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "recebimento_antes_nf",
      entidadeId: null,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return {
      ok: false as const,
      message: "Apenas admin ou financeiro pode registrar recebimento antes da NF.",
    };
  }
  return { ok: true as const, supabase: createClient() };
}

/** O texto da exceção do banco já vem pronto para a tela; o técnico não. */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

function revalidar() {
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
}

const registrarSchema = z
  .object({
    envio_nota_id: z.string().uuid().nullable(),
    item_bv_id: z.string().uuid().nullable(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do recebimento."),
    conta_bancaria_id: z.string().uuid("Selecione a conta que recebeu."),
    valor: z.number().positive("Informe o valor recebido."),
    plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
    plano_conta_subtipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
  })
  .refine((d) => (d.envio_nota_id === null) !== (d.item_bv_id === null), {
    message: "Informe a nota do envio ou o BV.",
  });

export async function registrarRecebimentoAntesNf(input: unknown): Promise<Result> {
  const parsed = registrarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await gateFinanceiro("recebimento_antes_nf.registrado");
  if (!gate.ok) return gate;
  const d = parsed.data;

  // A função grava o lançamento, o recebimento e a auditoria na mesma
  // transação.
  const { error } = await gate.supabase.rpc("registrar_recebimento_antes_nf", {
    p_envio_nota_id: d.envio_nota_id,
    p_item_bv_id: d.item_bv_id,
    p_data: d.data,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_valor: d.valor,
    p_tipo_id: d.plano_conta_tipo_id,
    p_subtipo_id: d.plano_conta_subtipo_id,
  });
  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível registrar o recebimento."),
    };
  }

  revalidar();
  return { ok: true };
}

// O câmbio fechado do job internacional (decisão 229): o bruto em R$ e,
// à parte, o valor na moeda, a cotação, o IOF e a tarifa. A função confere
// que o job é internacional, que a nota ainda não tem recebimento e que o
// bruto é o valor na moeda vezes a cotação; grava o bruto, o IOF e a tarifa
// como lançamentos do job e a variação cambial no recebimento.
const registrarCambioSchema = z.object({
  envio_nota_id: z.string().uuid("Informe a nota do envio."),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do recebimento."),
  conta_bancaria_id: z.string().uuid("Selecione a conta que recebeu."),
  valor: z.number().positive("Informe o valor recebido."),
  valor_moeda: z.number().positive("Informe o valor recebido na moeda."),
  cotacao: z.number().positive("Informe a cotação do dia."),
  iof: z.number().min(0, "O IOF não pode ser negativo."),
  tarifa: z.number().min(0, "A tarifa não pode ser negativa."),
  plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
});

export async function registrarRecebimentoCambio(input: unknown): Promise<Result> {
  const parsed = registrarCambioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await gateFinanceiro("recebimento_antes_nf.registrado");
  if (!gate.ok) return gate;
  const d = parsed.data;

  const { error } = await gate.supabase.rpc("registrar_recebimento_antes_nf_cambio", {
    p_envio_nota_id: d.envio_nota_id,
    p_data: d.data,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_valor_moeda: d.valor_moeda,
    p_cotacao: d.cotacao,
    p_bruto: d.valor,
    p_iof: d.iof,
    p_tarifa: d.tarifa,
    p_tipo_id: d.plano_conta_tipo_id,
    p_subtipo_id: d.plano_conta_subtipo_id,
  });
  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível registrar o recebimento."),
    };
  }

  revalidar();
  return { ok: true };
}

const cancelarSchema = z.object({
  id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Escreva o motivo do cancelamento (mínimo 10 caracteres)."),
});

export async function cancelarRecebimentoAntesNf(input: unknown): Promise<Result> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await gateFinanceiro("recebimento_antes_nf.cancelado");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("cancelar_recebimento_antes_nf", {
    p_id: parsed.data.id,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível cancelar o recebimento."),
    };
  }

  revalidar();
  return { ok: true };
}
