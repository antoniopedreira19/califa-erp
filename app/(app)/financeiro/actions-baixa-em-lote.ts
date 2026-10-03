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
 *   (`contas-a-receber/actions-recebimento-avulso.ts`);
 * - imposto a pagar → `darBaixaImposto` (`fiscal/impostos/actions.ts`,
 *   módulo fiscal, entrega 2), com a multa e os juros e os anexos de cada
 *   guia.
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
 *
 * Retenção na fonte (módulo fiscal, 02/10/2026): a parcela de PP sai com as
 * alíquotas da APROVAÇÃO da PP (`pedidos_compra_retencoes`), relidas aqui,
 * numa leitura só para o lote inteiro, antes da primeira baixa — o que a
 * tela mostrou não decide o que se retém. Se a leitura falhar, nenhuma
 * baixa é feita: sem saber a retenção, a PP sairia pelo bruto.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  aliquotasDaParcela,
  baixaEmLoteSchema,
  montarChamadas,
  type AliquotasDaAprovacao,
  type ChamadaDaBaixa,
  type ResultadoDaBaixaEmLote,
} from "@/lib/financeiro/baixa-em-lote";
import { montarRetencaoDaAprovacao } from "@/lib/fiscal/retencao-da-aprovacao";
import { darBaixaTitulo as darBaixaTituloPagar } from "./contas-a-pagar/actions-titulos";
import { darBaixaTitulo as darBaixaTituloReceber } from "./contas-a-receber/actions";
import { darBaixaRecebimentoAvulso } from "./contas-a-receber/actions-recebimento-avulso";
import { darBaixaImposto } from "./fiscal/impostos/actions";

/** As telas que mostram título, saldo ou extrato. Cada action individual
 *  já revalida as suas; aqui vale para o lote inteiro, inclusive quando
 *  ele para no meio. */
function revalidarListas() {
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/fiscal");
  revalidatePath("/financeiro");
}

/** `redirect()` e `notFound()` do Next viajam como exceção: não se engolem. */
function ehDesvioDoNext(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

const SEM_PERMISSAO = "Apenas admin ou financeiro pode executar esta ação.";
const ERRO_DA_LEITURA = "Não foi possível buscar as retenções da aprovação das PPs.";

/**
 * A trava das baixas (`darBaixaTitulo`) e da leitura das retenções da
 * aprovação (`lerRetencaoDaAprovacao`): só admin ou financeiro, com
 * `acao_negada` no audit.
 */
async function travaDoFinanceiro(acaoTentada: string) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "titulo_pagar",
      entidadeId: null,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false as const };
  }
  return { ok: true as const, session, supabase: createClient() };
}

/** Lote de ids por consulta: a lista vai na URL do PostgREST. */
const POR_CONSULTA = 50;

interface ParcelaComRetencao {
  id: string;
  pp: {
    verba_producao: boolean | null;
    retencoes: Array<{ imposto: string; aliquota: number | string | null }> | null;
  } | null;
}

/**
 * As alíquotas que valem na baixa de cada parcela de PP: as da aprovação,
 * menos na PP de verba e na parcela que já foi para uma remessa CNAB não
 * cancelada (`aliquotasDaParcela`). Uma entrada por parcela encontrada;
 * `null` se a leitura falhou.
 */
async function aliquotasDasParcelas(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  parcelaIds: string[],
): Promise<Map<string, AliquotasDaAprovacao | null> | null> {
  const mapa = new Map<string, AliquotasDaAprovacao | null>();
  const ids = Array.from(new Set(parcelaIds));
  const fatias: string[][] = [];
  for (let i = 0; i < ids.length; i += POR_CONSULTA) fatias.push(ids.slice(i, i + POR_CONSULTA));

  const respostas = await Promise.all(
    fatias.map((fatia) =>
      Promise.all([
        supabase
          .from("pedidos_compra_parcelas")
          .select(
            "id, pp:pedidos_compra!pedido_compra_id(verba_producao, retencoes:pedidos_compra_retencoes(imposto, aliquota))",
          )
          .in("id", fatia)
          .eq("tenant_id", tenantId)
          .returns<ParcelaComRetencao[]>(),
        // O mesmo critério da `_documento_em_remessa` do banco: remessa
        // cancelada não conta.
        supabase
          .from("cnab_remessas_itens")
          .select("origem_id, remessa:cnab_remessas!inner(status)")
          .in("origem_id", fatia)
          .eq("tenant_id", tenantId)
          .neq("remessa.status", "cancelado"),
      ]),
    ),
  );

  for (const [parcelas, remessas] of respostas) {
    if (parcelas.error || remessas.error) {
      console.error(
        "[baixa_em_lote.retencoes]",
        parcelas.error?.message ?? remessas.error?.message,
      );
      return null;
    }
    const emRemessa = new Set(
      ((remessas.data ?? []) as Array<{ origem_id: string }>).map((i) => i.origem_id),
    );
    for (const p of parcelas.data ?? []) {
      const daAprovacao = montarRetencaoDaAprovacao(p.pp?.retencoes ?? [], null);
      mapa.set(
        p.id,
        aliquotasDaParcela({
          verba: p.pp?.verba_producao === true,
          emRemessa: emRemessa.has(p.id),
          aliquotas: daAprovacao?.aliquotas ?? null,
        }),
      );
    }
  }
  return mapa;
}

/**
 * Para o diálogo do lote: as alíquotas que cada parcela de PP selecionada
 * vai reter (`null` = sem retenção). Só leitura; o lote relê na hora de
 * baixar. Parcela que não volta (PP cancelada com a tela aberta) fica de
 * fora do resultado.
 */
export async function lerRetencoesDoLote(
  parcelaIds: unknown,
): Promise<
  | { ok: true; aliquotas: Record<string, AliquotasDaAprovacao | null> }
  | { ok: false; message: string }
> {
  const ids = z.array(z.string().uuid()).max(200).safeParse(parcelaIds);
  if (!ids.success) return { ok: false, message: ERRO_DA_LEITURA };

  const trava = await travaDoFinanceiro("pedido_compra.retencoes_da_aprovacao_lidas");
  if (!trava.ok) return { ok: false, message: SEM_PERMISSAO };

  const mapa = await aliquotasDasParcelas(trava.supabase, trava.session.activeTenant.id, ids.data);
  if (!mapa) return { ok: false, message: ERRO_DA_LEITURA };
  return { ok: true, aliquotas: Object.fromEntries(mapa) };
}

async function executar(c: ChamadaDaBaixa): Promise<{ ok: true } | { ok: false; message: string }> {
  switch (c.acao) {
    case "pagar":
      return darBaixaTituloPagar(c.entrada);
    case "receber_nf":
      return darBaixaTituloReceber(c.entrada);
    case "receber_avulso":
      return darBaixaRecebimentoAvulso(c.entrada);
    case "imposto":
      return darBaixaImposto(c.entrada);
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

  const trava = await travaDoFinanceiro("titulos.baixa_em_lote");
  if (!trava.ok) {
    return { ok: false, feitas: [], falha: { chave: null, rotulo: null, mensagem: SEM_PERMISSAO } };
  }

  // A retenção de cada parcela de PP, relida aqui (não vem da tela).
  const parcelasDePP = parsed.data.itens.flatMap((i) =>
    i.alvo.modulo === "pagar" && i.alvo.origem === "pp" ? [i.alvo.id] : [],
  );
  const aliquotas = await aliquotasDasParcelas(
    trava.supabase,
    trava.session.activeTenant.id,
    parcelasDePP,
  );
  if (!aliquotas) {
    return {
      ok: false,
      feitas: [],
      falha: { chave: null, rotulo: null, mensagem: `${ERRO_DA_LEITURA} Nenhuma baixa foi feita.` },
    };
  }

  const montagem = montarChamadas(parsed.data, aliquotas);
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
