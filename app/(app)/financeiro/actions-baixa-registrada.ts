"use server";

/**
 * Cancelar e estornar uma baixa já registrada — as duas ações do popup do
 * olho, em Títulos a Receber e em Títulos a Pagar (decisão 120).
 *
 * - **Cancelar** desfaz a baixa: o lançamento sai do extrato, sem linha
 *   nova, e o título volta ao estado de antes (Em aberto / A pagar). Os
 *   estornos registrados na baixa saem junto. É a ferramenta de corrigir
 *   erro, e vale para todo tipo de baixa.
 * - **Estornar** registra uma transação nova, com data, conta e valor
 *   escolhidos agora, e o título continua pago. No receber é receita
 *   negativa; no pagar, despesa negativa.
 *
 * As duas pontas dividem este arquivo porque a regra é a mesma e mora no
 * banco (`cancelar_baixa_*` e `estornar_valor_da_baixa`), que também
 * exige admin ou financeiro e grava o log de auditoria na mesma transação.
 * O gate daqui só existe para responder cedo e registrar `acao_negada`.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Result = { ok: true } | { ok: false; message: string };

const motivoSchema = z
  .string()
  .trim()
  .min(10, "Explique o motivo em pelo menos 10 caracteres.")
  .max(500, "O motivo passa de 500 caracteres.");

/**
 * O que a tela chama de "tipo" da baixa. `avulso` e `recorrencia` são a
 * mesma tabela (`contas_avulsas`); o par {tipo, id} é o mesmo que a baixa
 * usou na ida.
 *
 * `baixa` cancela UMA baixa pelo lançamento dela (decisão 125): título a
 * receber, parcela de PP e conta avulsa aceitam várias baixas, e o `id` é
 * o do lançamento. Os tipos por documento ficam para quem só tem uma
 * baixa (desembolso, devolução de verba, fatura, transferência).
 */
const tipoSchema = z.enum([
  "baixa",
  "titulo_receber",
  "pp",
  "avulso",
  "recorrencia",
  "desembolso",
  "pp_devolucao_verba",
  "fatura_cartao",
  // Transferência entre contas (decisão 124): as duas pernas saem juntas.
  "transferencia",
]);

export type TipoDeBaixa = z.infer<typeof tipoSchema>;

const RPC_DO_CANCELAMENTO: Record<
  TipoDeBaixa,
  { rpc: string; param: string }
> = {
  baixa: { rpc: "cancelar_baixa_lancamento", param: "p_lancamento_id" },
  titulo_receber: { rpc: "cancelar_baixa_titulo_receber", param: "p_titulo_id" },
  pp: { rpc: "cancelar_baixa_pp_parcela", param: "p_parcela_id" },
  avulso: { rpc: "cancelar_baixa_avulsa", param: "p_conta_avulsa_id" },
  recorrencia: { rpc: "cancelar_baixa_avulsa", param: "p_conta_avulsa_id" },
  desembolso: { rpc: "cancelar_baixa_desembolso_parcela", param: "p_parcela_id" },
  pp_devolucao_verba: { rpc: "cancelar_baixa_devolucao_verba", param: "p_devolucao_id" },
  fatura_cartao: { rpc: "cancelar_baixa_fatura_cartao", param: "p_fatura_id" },
  transferencia: { rpc: "cancelar_baixa_transferencia", param: "p_transferencia_id" },
};

/**
 * As funções do banco levantam exceção com o texto pronto para a tela; o
 * que não for assim (erro técnico, com identificador ou aspas) vira a
 * mensagem genérica.
 */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

async function gateFinanceiro(
  entidadeTipo: string,
  entidadeId: string,
  acaoTentada: string,
) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return {
      ok: false as const,
      message: "Apenas admin ou financeiro pode cancelar ou estornar uma baixa.",
    };
  }
  return { ok: true as const, supabase: createClient() };
}

/** Tudo que enxerga dinheiro entrando ou saindo. */
function revalidarBaixas() {
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
}

// ---------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------

const cancelarSchema = z.object({
  tipo: tipoSchema,
  id: z.string().uuid(),
  motivo: motivoSchema,
});

export async function cancelarBaixa(input: unknown): Promise<Result> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const gate = await gateFinanceiro(d.tipo, d.id, "baixa.cancelada");
  if (!gate.ok) return gate;

  const { rpc, param } = RPC_DO_CANCELAMENTO[d.tipo];
  const { error } = await gate.supabase.rpc(rpc, {
    [param]: d.id,
    p_motivo: d.motivo,
  });

  if (error) {
    console.error("[baixa.cancelar]", d.tipo, error.message);
    return {
      ok: false,
      message: mensagemDoBanco(
        error.message,
        "Não foi possível cancelar a baixa. Tente novamente.",
      ),
    };
  }

  revalidarBaixas();
  return { ok: true };
}

// ---------------------------------------------------------------------
// Estornar
// ---------------------------------------------------------------------

const estornarSchema = z.object({
  /** O lançamento da baixa viva — o estorno se pendura nele. */
  lancamento_id: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do estorno."),
  conta_bancaria_id: z.string().uuid("Escolha a conta do estorno."),
  valor: z.number().positive("Informe o valor do estorno."),
  motivo: motivoSchema,
});

export async function estornarValorDaBaixa(input: unknown): Promise<Result> {
  const parsed = estornarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const gate = await gateFinanceiro(
    "lancamento_financeiro",
    d.lancamento_id,
    "baixa.estornada",
  );
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("estornar_valor_da_baixa", {
    p_lancamento_id: d.lancamento_id,
    p_data: d.data,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_valor: d.valor,
    p_motivo: d.motivo,
  });

  if (error) {
    console.error("[baixa.estornar]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(
        error.message,
        "Não foi possível registrar o estorno. Tente novamente.",
      ),
    };
  }

  revalidarBaixas();
  return { ok: true };
}
