"use client";

/**
 * Módulo fiscal (entrega 1, 02/10/2026): a baixa de uma parcela de PP busca,
 * ao abrir, as retenções que o financeiro informou na aprovação da PP
 * (`lerRetencaoDaAprovacao`). O formulário é montado com `key` do título, e
 * a busca acontece uma vez por parcela.
 *
 * Enquanto busca, a chave de retenção fica desligada com o aviso
 * "Buscando…" e a baixa não confirma: assim nada que a pessoa faça na
 * retenção é atropelado pelo que chega depois, e a parcela nunca sai sem a
 * retenção que a aprovação decidiu. Se a leitura falhar, a baixa segue como
 * era antes (em branco), e a ajuda da chave diz que não deu para buscar.
 */

import * as React from "react";
import { lerRetencaoDaAprovacao } from "@/app/(app)/financeiro/contas-a-pagar/actions-retencao-da-aprovacao";
import {
  textoDaRetencaoDaAprovacao,
  type RetencaoDaAprovacao,
} from "@/lib/fiscal/retencao-da-aprovacao";

/** O texto da chave enquanto a busca não volta. */
export const BUSCANDO_RETENCAO_DA_APROVACAO = "Buscando as retenções da aprovação da PP…";

const ERRO_DA_BUSCA = "Não foi possível buscar as retenções da aprovação da PP.";

/** O que voltou do servidor, e para qual parcela. */
type Resultado =
  | { parcelaId: string; ok: true; retencao: RetencaoDaAprovacao | null }
  | { parcelaId: string; ok: false };

export interface RetencaoDaAprovacaoNaBaixa {
  /** As alíquotas da aprovação; `null` enquanto busca, sem retenção, sem PP ou com erro. */
  retencao: RetencaoDaAprovacao | null;
  /** A busca ainda não voltou: a chave fica travada e a baixa não confirma. */
  buscando: boolean;
  /** A ajuda ao lado da chave quando ela está liberada; `null` = nenhuma. */
  ajuda: string | null;
}

/**
 * `parcelaId` nulo = não há o que buscar (título que não é parcela de PP,
 * ou cuja retenção não se aplica): fica tudo como antes.
 */
export function useRetencaoDaAprovacao(parcelaId: string | null): RetencaoDaAprovacaoNaBaixa {
  const [resultado, setResultado] = React.useState<Resultado | null>(null);

  React.useEffect(() => {
    if (!parcelaId) return;
    let vivo = true;
    lerRetencaoDaAprovacao(parcelaId)
      .then((res) => {
        if (!vivo) return;
        setResultado(
          res.ok ? { parcelaId, ok: true, retencao: res.retencao } : { parcelaId, ok: false },
        );
      })
      .catch(() => {
        if (vivo) setResultado({ parcelaId, ok: false });
      });
    return () => {
      vivo = false;
    };
  }, [parcelaId]);

  if (!parcelaId) return { retencao: null, buscando: false, ajuda: null };
  // Ainda não voltou — ou o que voltou é de outra parcela.
  if (!resultado || resultado.parcelaId !== parcelaId) {
    return { retencao: null, buscando: true, ajuda: null };
  }
  if (!resultado.ok) return { retencao: null, buscando: false, ajuda: ERRO_DA_BUSCA };
  return {
    retencao: resultado.retencao,
    buscando: false,
    ajuda: resultado.retencao ? textoDaRetencaoDaAprovacao(resultado.retencao) : null,
  };
}
