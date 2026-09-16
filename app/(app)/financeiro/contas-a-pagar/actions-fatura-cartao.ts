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
import { rateioSchema } from "@/lib/validations/conta-avulsa";

type Result = { ok: true } | { ok: false; message: string };

const ajusteSchema = z.object({
  descricao: z.string().trim().max(200).nullable().default(null),
  tipo_id: z.string().uuid("Escolha o tipo do plano de contas."),
  subtipo_id: z.string().uuid("Escolha o subtipo do plano de contas."),
  valor: z
    .number({ invalid_type_error: "Informe o valor do item." })
    .positive("O valor do item precisa ser maior que zero."),
  // O mesmo rateio de qualquer despesa sem job (decisão 082): o banco
  // recusa a compra sem ele, e a soma tem que dar 100.
  rateio: rateioSchema,
});

const schema = z.object({
  fatura_id: z.string().uuid(),
  // Sem `.positive()`: a fatura credora — estorno maior que as compras do
  // mês — fecha com valor zero ou negativo, e nesse caso simplesmente não
  // vira título (29/08/2026).
  valor_cobrado: z.number({
    invalid_type_error: "Informe o valor cobrado pelo banco.",
  }),
  // A diferença para o valor cobrado vira compra da fatura — uma ou
  // várias (decisão 084). Vazio quando a fatura já fecha no valor.
  ajustes: z.array(ajusteSchema).default([]),
});

const reabrirSchema = z.object({
  fatura_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(3, "Diga por que a fatura está sendo reaberta.")
    .max(300),
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
    p_ajustes: d.ajustes,
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
      itens_de_ajuste: d.ajustes.length,
      valor_do_ajuste: d.ajustes.reduce((s, a) => s + a.valor, 0),
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true };
}

/**
 * O rateio que o fechamento sugere para o ajuste.
 *
 * É a proporção em que as regionais gastaram NESTA fatura — a compra
 * avulsa entra pelo rateio dela, a parcela de PP entra pela regional do
 * job (decisão 069). Volta vazio quando a fatura não tem nenhum item com
 * regional; aí o diálogo abre a linha em branco e o financeiro diz de quem
 * é.
 *
 * Fica numa action própria, chamada quando o diálogo abre, porque é um
 * número que quase nunca é usado — carregá-lo junto da página pesaria uma
 * tela inteira por causa de um caso de borda.
 */
export async function rateioProporcionalDaFatura(
  faturaId: string,
): Promise<
  | { ok: true; linhas: Array<{ regional_id: string; percentual: number }> }
  | { ok: false; message: string }
> {
  await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase.rpc("rateio_proporcional_da_fatura", {
    p_fatura_id: faturaId,
  });

  if (error) {
    console.error("[fatura_cartao.rateio_proporcional]", error.message);
    return { ok: false, message: limparMensagem(error.message) };
  }

  const linhas = ((data ?? []) as Array<{
    regional_id: string;
    percentual: number | string;
  }>).map((l) => ({
    regional_id: l.regional_id,
    percentual: Number(l.percentual),
  }));

  return { ok: true, linhas };
}

/** O Postgres prefixa a mensagem; o usuário só quer a frase. */
function limparMensagem(msg: string): string {
  return msg.replace(/^.*?(?:ERROR|error):\s*/i, "").trim() || msg;
}

/**
 * Reabrir uma fatura fechada.
 *
 * Existe porque fechar não pode ser porta de mão única: aparece uma
 * compra retroativa depois do fechamento, ou o valor não bate com o
 * extrato, e é preciso corrigir.
 *
 * Reabrir APAGA os lançamentos que o fechamento criou. Eles são
 * derivados — nascem inteiros a partir dos itens, e nenhum corresponde a
 * dinheiro que saiu do banco, porque a fatura não foi paga. O fechamento
 * seguinte os recria. Contra-lançar aqui encheria o razão do cartão de
 * pares +150/−150 a cada correção.
 *
 * Fatura paga não reabre: primeiro estorna a baixa (o dinheiro saiu de
 * verdade e isso ganha contra-lançamento), depois reabre.
 */
export async function reabrirFaturaCartao(input: unknown): Promise<Result> {
  const parsed = reabrirSchema.safeParse(input);
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
        acao_tentada: "fatura_cartao.reaberta",
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode reabrir fatura.",
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

  // A auditoria de dentro da RPC registra o antes (valor cobrado, quantos
  // lançamentos sumiram, quantos itens voltaram); aqui fica só o gate.
  const { error } = await supabase.rpc("reabrir_fatura_cartao", {
    p_fatura_id: d.fatura_id,
    p_motivo: d.motivo,
  });

  if (error) {
    console.error("[fatura_cartao.reabrir]", error.message);
    return { ok: false, message: limparMensagem(error.message) };
  }

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true };
}

/**
 * Estornar a baixa de uma fatura paga.
 *
 * Diferente de reabrir: aqui o dinheiro saiu do banco, então o desfazer é
 * contra-lançamento, não delete — o extrato do banco também vai mostrar
 * as duas pernas. A fatura volta para "fechada", e só então pode reabrir.
 *
 * ⚠️ Antes de 29/08/2026 `estornarBaixaTitulo` mandava a fatura para o
 * caminho da conta avulsa, que respondia "Conta avulsa não encontrada".
 * Estornar a baixa de uma fatura simplesmente não funcionava.
 */
export async function estornarBaixaFaturaCartao(
  faturaId: string,
  motivo: string,
): Promise<Result> {
  const session = await requireSession();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "fatura_cartao",
      entidadeId: faturaId,
      metadata: {
        acao_tentada: "fatura_cartao.baixa_estornada",
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode estornar baixa.",
    };
  }

  const supabase = createClient();

  const { data: fatura } = await supabase
    .from("faturas_cartao")
    .select("id, codigo, status")
    .eq("id", faturaId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!fatura) return { ok: false, message: "Fatura não encontrada." };

  const { error } = await supabase.rpc("estornar_baixa_fatura_cartao", {
    p_fatura_id: faturaId,
    p_motivo: motivo,
  });

  if (error) {
    console.error("[fatura_cartao.estornar]", error.message);
    return { ok: false, message: limparMensagem(error.message) };
  }

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true };
}
