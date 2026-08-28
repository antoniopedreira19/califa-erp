"use server";

/**
 * Fechar a fatura do cartão.
 *
 * É o momento em que a fatura vira contabilidade: cada item dela vira um
 * lançamento na conta do cartão, com o SEU plano de contas, e a fatura
 * desce para Títulos a Pagar como um título único.
 *
 * A diferença entre a soma dos itens e o que o banco cobrou vira um
 * lançamento de ajuste — IOF, anuidade e juros existem em toda fatura e
 * ninguém os lança. Sem esse ajuste a fatura nunca fecharia com o extrato.
 *
 * Toda a regra mora na RPC `fechar_fatura_cartao`; aqui ficam o gate de
 * permissão, a auditoria e a revalidação.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Result = { ok: true } | { ok: false; message: string };

const schema = z.object({
  fatura_id: z.string().uuid(),
  valor_cobrado: z
    .number({ invalid_type_error: "Informe o valor cobrado pelo banco." })
    .positive("O valor cobrado precisa ser maior que zero."),
  ajuste_tipo_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  ajuste_subtipo_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  ajuste_descricao: z.string().trim().max(200).nullable().default(null),
});

export async function fecharFaturaCartao(input: unknown): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
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
      entidadeTipo: "fatura_cartao",
      entidadeId: d.fatura_id,
      metadata: {
        acao_tentada: "fatura_cartao.fechada",
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode fechar fatura.",
    };
  }

  const supabase = createClient();

  const { data: fatura } = await supabase
    .from("faturas_cartao")
    .select("id, codigo, status")
    .eq("id", d.fatura_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!fatura) return { ok: false, message: "Fatura não encontrada." };

  const { error } = await supabase.rpc("fechar_fatura_cartao", {
    p_fatura_id: d.fatura_id,
    p_valor_cobrado: d.valor_cobrado,
    p_ajuste_tipo_id: d.ajuste_tipo_id,
    p_ajuste_subtipo_id: d.ajuste_subtipo_id,
    p_ajuste_descricao: d.ajuste_descricao,
  });

  if (error) {
    console.error("[fatura_cartao.fechar]", error.message);
    // A RPC recusa o fechamento com diferença sem plano de ajuste, e a
    // mensagem dela já traz os dois valores e a diferença — é mais útil
    // que qualquer texto genérico que eu pusesse aqui.
    return { ok: false, message: limparMensagem(error.message) };
  }

  await logAuditEvent({
    acao: "fatura_cartao.fechada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fatura_cartao",
    entidadeId: d.fatura_id,
    metadata: {
      codigo: fatura.codigo,
      valor_cobrado: d.valor_cobrado,
      teve_ajuste: d.ajuste_tipo_id !== null,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true };
}

/** O Postgres prefixa a mensagem; o usuário só quer a frase. */
function limparMensagem(msg: string): string {
  return msg.replace(/^.*?(?:ERROR|error):\s*/i, "").trim() || msg;
}
