"use server";

/**
 * Baixa em lote — Títulos a Pagar e Títulos a Receber (pedido do Tiago em
 * 02/10/2026; desenho aprovado no protótipo do módulo fiscal).
 *
 * Uma data, uma conta, uma forma de pagamento (quando há título a pagar) e
 * o centro de custo de quem ainda não tem um — e cada título vira a SUA
 * baixa e o SEU lançamento, como se tivessem sido feitos um a um. Por isso
 * esta action não fala com o banco: ela chama, título por título e na
 * ordem, a mesma action da baixa individual:
 *
 * - a pagar → `darBaixaTitulo` (`contas-a-pagar/actions-titulos.ts`);
 * - nota fiscal → `darBaixaTitulo` (`contas-a-receber/actions.ts`);
 * - recebimento avulso → `darBaixaRecebimentoAvulso`
 *   (`contas-a-receber/actions-recebimento-avulso.ts`).
 *
 * Cada uma confere a sessão e o papel (admin ou financeiro, com
 * `acao_negada` no audit), valida a entrada, chama a RPC — que confere de
 * novo, no banco, o papel, o que falta, a conta e o centro de custo — e
 * grava o próprio evento de auditoria. Nada disso é repetido aqui.
 *
 * O lote PARA no primeiro erro: o que já foi baixado fica (é baixa de
 * verdade, conferida e auditada), e a resposta diz o que foi feito e onde
 * parou, com a mensagem. A formação da entrada (e o teste dela) mora em
 * `lib/financeiro/baixa-em-lote.ts`.
 */

import { revalidatePath } from "next/cache";
import {
  baixaEmLoteSchema,
  montarChamadas,
  type ChamadaDaBaixa,
  type ResultadoDaBaixaEmLote,
} from "@/lib/financeiro/baixa-em-lote";
import { darBaixaTitulo as darBaixaTituloPagar } from "./contas-a-pagar/actions-titulos";
import { darBaixaTitulo as darBaixaTituloReceber } from "./contas-a-receber/actions";
import { darBaixaRecebimentoAvulso } from "./contas-a-receber/actions-recebimento-avulso";

/** As telas que mostram título, saldo ou extrato. Cada action individual
 *  já revalida as suas; aqui vale para o lote inteiro, inclusive quando
 *  ele para no meio. */
function revalidarListas() {
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
}

/** `redirect()` e `notFound()` do Next viajam como exceção: não se engolem. */
function ehDesvioDoNext(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

async function executar(c: ChamadaDaBaixa): Promise<{ ok: true } | { ok: false; message: string }> {
  switch (c.acao) {
    case "pagar":
      return darBaixaTituloPagar(c.entrada);
    case "receber_nf":
      return darBaixaTituloReceber(c.entrada);
    case "receber_avulso":
      return darBaixaRecebimentoAvulso(c.entrada);
  }
}

export async function darBaixaEmLote(input: unknown): Promise<ResultadoDaBaixaEmLote> {
  const parsed = baixaEmLoteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      feitas: [],
      falha: {
        chave: null,
        rotulo: null,
        mensagem: parsed.error.issues[0]?.message ?? "Entrada inválida.",
      },
    };
  }

  const montagem = montarChamadas(parsed.data);
  if (!montagem.ok) {
    return { ok: false, feitas: [], falha: { chave: null, rotulo: null, mensagem: montagem.mensagem } };
  }

  const feitas: string[] = [];
  for (const chamada of montagem.chamadas) {
    let res: { ok: true } | { ok: false; message: string };
    try {
      res = await executar(chamada);
    } catch (e) {
      if (ehDesvioDoNext(e)) throw e;
      console.error("[baixa_em_lote]", chamada.acao, chamada.chave, e);
      res = { ok: false, message: "Não foi possível dar baixa. Tente novamente." };
    }
    if (!res.ok) {
      if (feitas.length > 0) revalidarListas();
      return {
        ok: false,
        feitas,
        falha: { chave: chamada.chave, rotulo: chamada.rotulo, mensagem: res.message },
      };
    }
    feitas.push(chamada.chave);
  }

  revalidarListas();
  return { ok: true, feitas };
}
