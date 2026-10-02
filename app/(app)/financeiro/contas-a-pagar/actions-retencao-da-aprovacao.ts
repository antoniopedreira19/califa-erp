"use server";

/**
 * Módulo fiscal (entrega 1, 02/10/2026): as retenções na fonte que o
 * financeiro informou na aprovação da PP, lidas quando a baixa de uma
 * parcela dela abre. A baixa chega com elas — a chave "Reter impostos na
 * fonte" ligada e as alíquotas editáveis — e grava o que de fato reteve em
 * `baixas_retencoes`, como sempre.
 *
 * Uma leitura avulsa, na abertura do pop-up, e não um campo a mais na linha
 * da lista: a baixa é uma parcela por vez, e a lista e a página de Títulos
 * a Pagar ficam como estão.
 *
 * Só leitura. `pedidos_compra_retencoes` só se grava pela função
 * `registrar_nf_da_pp`, na aprovação.
 */

import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  diaEmSaoPaulo,
  montarRetencaoDaAprovacao,
  type RetencaoDaAprovacao,
} from "@/lib/fiscal/retencao-da-aprovacao";

type Resultado =
  | { ok: true; retencao: RetencaoDaAprovacao | null }
  | { ok: false; message: string };

const ERRO_DA_LEITURA = "Não foi possível buscar as retenções da aprovação da PP.";

interface LinhaDaParcela {
  pp: {
    aprovada_em: string | null;
    nf_registrada_em: string | null;
    retencoes: Array<{ imposto: string; aliquota: number | string | null }> | null;
  } | null;
}

/**
 * As alíquotas retidas da aprovação da PP de uma parcela. `retencao: null`
 * quando a PP foi aprovada sem retenção (ou antes do módulo fiscal): a
 * baixa abre como sempre abriu.
 *
 * Mesma trava da baixa (`darBaixaTitulo`): só admin ou financeiro, com
 * `acao_negada` no audit.
 */
export async function lerRetencaoDaAprovacao(parcelaId: unknown): Promise<Resultado> {
  const id = z.string().uuid().safeParse(parcelaId);
  if (!id.success) return { ok: false, message: ERRO_DA_LEITURA };

  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: id.data,
      metadata: {
        acao_tentada: "pedido_compra.retencoes_da_aprovacao_lidas",
        motivo: "sem_permissao_financeira",
      },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("pedidos_compra_parcelas")
    .select(
      "pp:pedidos_compra!pedido_compra_id(aprovada_em, nf_registrada_em, retencoes:pedidos_compra_retencoes(imposto, aliquota))",
    )
    .eq("id", id.data)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<LinhaDaParcela>();

  if (error) {
    console.error("[contas-a-pagar.retencoes-da-aprovacao]", error.message);
    return { ok: false, message: ERRO_DA_LEITURA };
  }
  // A parcela some quando a PP é cancelada com a lista aberta: sem PP, não
  // há retenção a trazer — a baixa em si é que vai recusar.
  const pp = data?.pp ?? null;
  if (!pp) return { ok: true, retencao: null };

  // O dia da aprovação; a NF registrada na mesma aprovação é a rede para a
  // PP que não guardou o carimbo.
  const dia = diaEmSaoPaulo(pp.aprovada_em) ?? diaEmSaoPaulo(pp.nf_registrada_em);
  return { ok: true, retencao: montarRetencaoDaAprovacao(pp.retencoes ?? [], dia) };
}
