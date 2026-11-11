"use server";

/**
 * As ações da conciliação dia a dia (decisão 253) que as de sempre da aba
 * (`actions-conciliacao.ts`) não cobriam.
 *
 * `conciliarMisto`: a linha do banco que paga, de uma vez, baixas que já
 * estavam no sistema e títulos ainda em aberto. Os títulos ganham a baixa
 * com os dados do banco (a baixa em lote de sempre, com as travas e a
 * retenção da aprovação) e a linha se liga a tudo. A soma é conferida pelo
 * banco (`conciliar_linha`).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { EntradaDaBaixaEmLote } from "@/lib/financeiro/baixa-em-lote";
import { baixarEConciliar, baixarPelaLinha } from "./actions-conciliacao";

type Resultado = { ok: true; mensagem?: string } | { ok: false; message: string };
type ItensDaBaixa = EntradaDaBaixaEmLote["itens"];

const UUID = z.string().uuid();

async function gate() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false as const, message: "Só admin ou financeiro concilia o extrato do banco." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

function revalidar() {
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
}

/** As funções do banco levantam exceção com o texto pronto para a tela; o
 *  que não for assim (erro técnico) vira a mensagem genérica. */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

/** A coluna de `lancamentos_financeiros` que guarda o documento de cada baixa do lote. */
function baixaDoItem(alvo: ItensDaBaixa[number]["alvo"]): { origem: string; coluna: string } {
  if (alvo.modulo === "imposto") return { origem: "imposto_baixa", coluna: "imposto_a_pagar_id" };
  if (alvo.modulo === "receber") return alvo.origem === "nf" ? { origem: "titulo_baixa", coluna: "titulo_receber_id" } : { origem: "avulsa_baixa", coluna: "conta_avulsa_id" };
  return alvo.origem === "pp" ? { origem: "pp_baixa", coluna: "pedido_compra_parcela_id" } : { origem: "avulsa_baixa", coluna: "conta_avulsa_id" };
}

export async function conciliarMisto(entrada: { linhaId: string; lancamentoIds: string[]; itens: ItensDaBaixa }): Promise<Resultado> {
  if (!UUID.safeParse(entrada.linhaId).success || !z.array(UUID).max(500).safeParse(entrada.lancamentoIds).success) {
    return { ok: false, message: "Entrada inválida." };
  }
  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0 || entrada.itens.length > 100) return { ok: false, message: "Entrada inválida." };
  // Só títulos: é o "baixar e conciliar" de sempre, que o Desfazer sabe cancelar.
  if (entrada.lancamentoIds.length === 0) return baixarEConciliar({ linhaId: entrada.linhaId, itens: entrada.itens });

  const g = await gate();
  if (!g.ok) return g;
  const tenantId = g.session.activeTenant.id;
  const { data: linha, error } = await g.supabase
    .from("vw_extrato_linhas")
    .select("id, conta_bancaria_id, data")
    .eq("tenant_id", tenantId)
    .eq("id", entrada.linhaId)
    .maybeSingle<{ id: string; conta_bancaria_id: string; data: string }>();
  if (error || !linha) return { ok: false, message: "Linha do extrato não encontrada." };

  const baixa = await baixarPelaLinha({ linhaId: entrada.linhaId, itens: entrada.itens });
  if (!baixa.ok) return baixa;

  // As baixas que acabaram de nascer: a de cada documento, nesta conta e sem linha.
  const achadas = await Promise.all(
    entrada.itens.map((i) => {
      const { origem, coluna } = baixaDoItem(i.alvo);
      return g.supabase
        .from("lancamentos_financeiros")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("conta_bancaria_id", linha.conta_bancaria_id)
        .is("extrato_linha_id", null)
        .eq("origem", origem)
        .eq(coluna, i.alvo.id)
        .eq("data_movimento", linha.data)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();
    }),
  );
  const novas = achadas.map((r) => r.data?.id).filter((id): id is string => !!id);
  if (novas.length !== entrada.itens.length) {
    revalidar();
    return {
      ok: false,
      message: "Os títulos foram baixados com os dados do banco, mas a linha ficou sem conciliar: as baixas aparecem em “Só no sistema” deste dia. Adicione-as à linha e concilie.",
    };
  }

  const { error: erroDaLiga } = await g.supabase.rpc("conciliar_linha", {
    p_linha_id: entrada.linhaId,
    p_lancamento_ids: [...entrada.lancamentoIds, ...novas],
    p_como: "ligacao",
    p_sozinha: null,
  });
  revalidar();
  if (erroDaLiga) {
    console.error("[conciliacao.conciliar_misto]", erroDaLiga.message);
    return {
      ok: false,
      message: `${mensagemDoBanco(erroDaLiga.message, "Não foi possível ligar a linha do banco.")} Os títulos já foram baixados e aparecem em “Só no sistema” deste dia.`,
    };
  }
  const n = entrada.lancamentoIds.length + novas.length;
  return {
    ok: true,
    mensagem: `${novas.length === 1 ? "1 título baixado" : `${novas.length} títulos baixados`} com os dados do banco e ${n} lançamentos conciliados com a linha.`,
  };
}
