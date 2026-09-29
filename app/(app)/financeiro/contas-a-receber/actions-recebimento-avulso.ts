"use server";

/**
 * O botão "Recebimento avulso" de Títulos a Receber (decisão 124).
 *
 * Recebimento avulso e rendimento de aplicação são contas avulsas de
 * natureza `entrada`, marcadas por `tipo_entrada`. Nascem pela função
 * `criar_titulo_receber_avulso`, que guarda no banco as regras dos dois
 * tipos (conta de aplicação, um rendimento por conta e mês, centro de
 * custo do rendimento, rateio obrigatório). A baixa é a de sempre da conta
 * avulsa, `dar_baixa_avulsa_com_plano`; cancelar e estornar vêm da
 * decisão 120.
 *
 * "Criar e dar baixa" segue o molde do lançamento avulso de Títulos a
 * Pagar: a tela cria e, em seguida, abre a baixa do título recém-criado.
 */

import { z } from "zod";
import { valorDaBaixaSchema } from "@/lib/validations/baixa-parcial";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { calcularSaldoAnterior } from "@/lib/calculos/saldo-conta";

type Result<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.");

async function gateFinanceiro(acaoTentada: string) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_avulsa",
      entidadeId: null,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return {
      ok: false as const,
      message: "Apenas admin ou financeiro pode lançar recebimento avulso.",
    };
  }
  return { ok: true as const, session, supabase: createClient() };
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

// ---------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------

const rateioSchema = z
  .array(
    z.object({
      regional_id: z.string().uuid("Escolha a regional de cada linha do rateio."),
      percentual: z.number().positive("Percentual do rateio precisa ser maior que zero."),
    }),
  )
  .min(1, "Informe o rateio de regional: ao menos uma regional.")
  .refine(
    (linhas) => Math.abs(linhas.reduce((s, l) => s + l.percentual, 0) - 100) < 0.01,
    "Rateio de regional: a soma dos percentuais deve ser 100,00.",
  )
  .refine(
    (linhas) => new Set(linhas.map((l) => l.regional_id)).size === linhas.length,
    "A mesma regional aparece duas vezes no rateio.",
  );

const criarSchema = z.discriminatedUnion("tipo_entrada", [
  z.object({
    tipo_entrada: z.literal("recebimento_avulso"),
    empresa_id: z.string().uuid("Escolha a empresa."),
    valor: z.number().positive("Informe o valor."),
    data_prevista: dataIso,
    descricao: z.string().trim().min(3, "Informe a descrição."),
    cliente_id: z.string().uuid().nullable(),
    fornecedor_id: z.string().uuid().nullable(),
    plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo."),
    plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo do centro de custo."),
    rateio: rateioSchema,
  }),
  z.object({
    tipo_entrada: z.literal("rendimento"),
    empresa_id: z.string().uuid("Escolha a empresa."),
    valor: z.number().positive("Informe o rendimento líquido do mês."),
    data_prevista: dataIso,
    conta_bancaria_prevista_id: z.string().uuid("Escolha a conta de aplicação."),
    competencia: dataIso,
    rateio: rateioSchema,
  }),
]);

export async function criarRecebimentoAvulso(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = criarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const gate = await gateFinanceiro("conta_avulsa.criada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { rateio, ...dados } = d;
  const { data: id, error } = await supabase.rpc("criar_titulo_receber_avulso", {
    p_dados: dados,
    p_rateio: rateio,
  });

  if (error || !id) {
    console.error("[recebimento_avulso.criar]", error?.message);
    return {
      ok: false,
      message: mensagemDoBanco(
        error?.message ?? "",
        "Não foi possível criar o recebimento. Tente novamente.",
      ),
    };
  }

  await logAuditEvent({
    acao: "conta_avulsa.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: id as string,
    metadata: {
      tipo_entrada: d.tipo_entrada,
      valor: d.valor,
      empresa_id: d.empresa_id,
      data_prevista: d.data_prevista,
      ...(d.tipo_entrada === "rendimento"
        ? { conta_bancaria_prevista_id: d.conta_bancaria_prevista_id, competencia: d.competencia }
        : { descricao: d.descricao }),
    },
  });

  revalidar();
  return { ok: true, id: id as string };
}

// ---------------------------------------------------------------------
// Dar baixa
// ---------------------------------------------------------------------

const baixaSchema = z.object({
  conta_avulsa_id: z.string().uuid(),
  pago_em: dataIso,
  conta_bancaria_id: z.string().uuid("Escolha a conta que recebeu."),
  plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o subtipo do centro de custo."),
  // Baixa parcial e impostos retidos (decisão 125).
  ...valorDaBaixaSchema,
});

export async function darBaixaRecebimentoAvulso(input: unknown): Promise<Result> {
  const parsed = baixaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const gate = await gateFinanceiro("conta_avulsa.baixada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: avulsa } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor, tipo_entrada")
    .eq("id", d.conta_avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!avulsa || !avulsa.tipo_entrada) {
    return { ok: false, message: "Título não encontrado." };
  }
  if (avulsa.status !== "aprovada") {
    return { ok: false, message: "Este título já foi recebido." };
  }

  // O banco confere o que falta, os retidos e onde só cabe o valor
  // inteiro (o rendimento).
  const { data: lancamentoId, error } = await supabase.rpc("baixar_conta_avulsa", {
    p_conta_avulsa_id: d.conta_avulsa_id,
    p_pago_em: d.pago_em,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_tipo_id: d.plano_conta_tipo_id,
    p_subtipo_id: d.plano_conta_subtipo_id,
    p_forma_pagamento: null,
    p_cartao_credito_id: null,
    p_valor_baixa: d.valor_baixa ?? null,
    p_retencoes: d.retencoes,
  });

  if (error) {
    console.error("[recebimento_avulso.baixa]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(
        error.message,
        "Não foi possível dar baixa. Tente novamente.",
      ),
    };
  }

  await logAuditEvent({
    acao: "conta_avulsa.baixada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: d.conta_avulsa_id,
    metadata: {
      tipo_entrada: avulsa.tipo_entrada,
      descricao: avulsa.descricao,
      valor: Number(avulsa.valor),
      valor_baixa: d.valor_baixa ?? null,
      retencoes: d.retencoes,
      pago_em: d.pago_em,
      conta_bancaria_id: d.conta_bancaria_id,
      lancamento_id: lancamentoId,
    },
  });

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------
// Transferência entre contas
// ---------------------------------------------------------------------
// Sem empresa, regional nem plano (D17.2), só entre contas do mesmo CNPJ
// (D4 pendente). "Criar e dar baixa" aqui é uma chamada só: a
// transferência já nasce feita, na data informada — não há o que
// escolher numa segunda tela.

const transferenciaSchema = z.object({
  conta_origem_id: z.string().uuid("Escolha a conta de origem."),
  conta_destino_id: z.string().uuid("Escolha a conta de destino."),
  valor: z.number().positive("Informe o valor da transferência."),
  data_prevista: dataIso,
  descricao: z.string().trim().max(200).nullable(),
  transferir: z.boolean(),
});

export async function criarTransferenciaEntreContas(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = transferenciaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const { transferir, ...dados } = parsed.data;
  if (dados.conta_origem_id === dados.conta_destino_id) {
    return { ok: false, message: "A conta de destino precisa ser diferente da de origem." };
  }

  const gate = await gateFinanceiro("transferencia.criada");
  if (!gate.ok) return gate;

  // O log de auditoria é gravado pela função do banco, na mesma transação.
  const { data: id, error } = await gate.supabase.rpc("criar_transferencia", {
    p_dados: dados,
    p_transferir: transferir,
  });
  if (error || !id) {
    console.error("[transferencia.criar]", error?.message);
    return {
      ok: false,
      message: mensagemDoBanco(
        error?.message ?? "",
        "Não foi possível lançar a transferência. Tente novamente.",
      ),
    };
  }

  revalidar();
  return { ok: true, id: id as string };
}

export async function darBaixaTransferencia(input: unknown): Promise<Result> {
  const parsed = z
    .object({ transferencia_id: z.string().uuid(), data: dataIso })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }

  const gate = await gateFinanceiro("transferencia.efetivada");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("dar_baixa_transferencia", {
    p_transferencia_id: parsed.data.transferencia_id,
    p_data: parsed.data.data,
  });
  if (error) {
    console.error("[transferencia.baixa]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(
        error.message,
        "Não foi possível registrar a transferência. Tente novamente.",
      ),
    };
  }

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------
// Excluir título em aberto criado por engano
// ---------------------------------------------------------------------
// Aprovado pelo Tiago em 29/09/2026 (decisão 124 §5). Só em aberto: o
// baixado cancela a baixa antes, para a exclusão nunca apagar movimento
// do extrato. O banco confere as duas coisas e grava o log.

const excluirSchema = z.object({
  origem: z.enum(["recebimento_avulso", "rendimento", "transferencia"]),
  id: z.string().uuid(),
});

export async function excluirTituloReceberAvulso(input: unknown): Promise<Result> {
  const parsed = excluirSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Entrada inválida." };
  const d = parsed.data;

  const gate = await gateFinanceiro(
    d.origem === "transferencia" ? "transferencia.excluida" : "conta_avulsa.excluida",
  );
  if (!gate.ok) return gate;

  const { error } =
    d.origem === "transferencia"
      ? await gate.supabase.rpc("excluir_transferencia", { p_transferencia_id: d.id })
      : await gate.supabase.rpc("excluir_titulo_receber_avulso", { p_conta_avulsa_id: d.id });

  if (error) {
    console.error("[titulo_receber_avulso.excluir]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível excluir. Tente novamente."),
    };
  }

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------
// Saldo da conta de aplicação (a prévia do rendimento)
// ---------------------------------------------------------------------

/** O saldo da conta no FIM do dia `data`: o que a aplicação tinha antes do
 *  rendimento daquele mês entrar, e a base da prévia da transferência. */
export async function saldoDaContaNoDia(input: unknown): Promise<Result<{ saldo: number }>> {
  const parsed = z
    .object({ conta_bancaria_id: z.string().uuid(), data: dataIso })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "Entrada inválida." };

  const gate = await gateFinanceiro("conta_bancaria.saldo_consultado");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const [a, m, dia] = parsed.data.data.split("-").map(Number);
  const seguinte = new Date(Date.UTC(a, m - 1, dia + 1)).toISOString().slice(0, 10);
  const { saldoAnterior } = await calcularSaldoAnterior(supabase, {
    tenantId: session.activeTenant.id,
    contaId: parsed.data.conta_bancaria_id,
    dataDe: seguinte,
  });
  return { ok: true, saldo: saldoAnterior };
}
