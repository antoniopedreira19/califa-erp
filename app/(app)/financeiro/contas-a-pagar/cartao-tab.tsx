"use client";

/**
 * Aba "Cartão" — a porta e o extrato (decisão 093, entrega 2, 20/09/2026).
 *
 * Mesmo padrão da Conciliação (decisão 091): sem cartão na URL, a CAPA —
 * um card por cartão com a fatura em curso (grade até cinco cartões,
 * lista com busca de seis em diante); com `?cartao=`, a FATURA daquele
 * cartão como extrato, com as mesmas colunas da conciliação, navegável
 * por competência (`?competencia=AAAA-MM`).
 *
 * A aba mostra só o que já teve baixa: o item entra na fatura quando o
 * pagamento é confirmado em Títulos a Pagar com forma "cartão". O que
 * ainda aparece como pendente é legado roteado antes da 093 (ou ajuste de
 * um fechamento reaberto), e entra na fatura quando ela fechar.
 *
 * Toda navegação daqui é por URL: o servidor monta o extrato da
 * competência pedida e devolve a página. A troca de aba em si não vai ao
 * servidor (ver `contas-pagar-tabs.tsx`).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import type { ExtratoDaFatura, StatusFatura } from "@/lib/data/fatura-cartao-extrato";
import type { TituloRow } from "./titulos-pagar-list";
import type { FaturaDoCartao } from "./fechar-fatura-dialog";
import { ContaAvulsaDrawer } from "./conta-avulsa-drawer";
import { CartaoCapa } from "./cartao-capa";
import { CartaoFatura } from "./cartao-fatura";

/** A fatura que o card da capa mostra: a aberta mais antiga do cartão
 *  (é a que o financeiro fecha primeiro), ou a fechada que espera baixa. */
export type FaturaEmCurso = {
  id: string;
  codigo: string;
  /** `AAAA-MM` do fechamento. */
  competencia: string;
  status: "aberta" | "fechada";
  total: number;
  qtd_itens: number;
  fecha: string;
  vence: string;
};

export type CartaoDaCapa = {
  cartao: CartaoOption;
  emCurso: FaturaEmCurso | null;
};

/** Uma fatura do cartão escolhido, para o calendário e as setas. */
export type FaturaDoCalendario = {
  id: string;
  codigo: string;
  competencia: string;
  status: StatusFatura;
  total: number;
};

export type FaturaTela = {
  cartaoId: string;
  competencia: string;
  /** `null` quando o cartão não tem fatura nessa competência. */
  extrato: ExtratoDaFatura | null;
  faturas: FaturaDoCalendario[];
};

export interface CartaoTabProps {
  cartoes: CartaoOption[];
  capa: CartaoDaCapa[];
  /** O que a URL pediu; `null` na capa. */
  tela: FaturaTela | null;
  /** As faturas abertas/fechadas com a soma que o fechamento usa. */
  faturasDoCartao: FaturaDoCartao[];
  /** Os títulos de cartão (a pagar + pagos): é por eles que a linha do
   *  extrato ganha as ações de estornar compra e ver a baixa. */
  titulos: TituloRow[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** Daqui para baixo, o que o drawer de conta avulsa precisa para o
   *  atalho "Lançar pagamento". */
  tenantId: string;
  empresas: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string; cpf_cnpj?: string | null }>;
  clientes: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
}

export function CartaoTab(props: CartaoTabProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function irPara(cartaoId: string | null, competencia?: string) {
    const params = new URLSearchParams({ tab: "cartao" });
    if (cartaoId) params.set("cartao", cartaoId);
    if (cartaoId && competencia) params.set("competencia", competencia);
    startTransition(() => {
      router.push(`/financeiro/contas-a-pagar?${params.toString()}`);
    });
  }

  // Lançar pagamento — a despesa que NASCE no cartão (assinatura, compra
  // sem pedido). É uma conta avulsa como qualquer outra, com código `AV-`;
  // o atalho só poupa reencontrar o cartão. Na capa abre sem
  // pré-seleção; dentro do cartão, já com ele.
  const lancarPagamento = (
    <ContaAvulsaDrawer
      mode="criar"
      tenantId={props.tenantId}
      empresas={props.empresas}
      tipos={props.tipos}
      subtipos={props.subtipos}
      fornecedores={props.fornecedores}
      clientes={props.clientes}
      regionais={props.regionais}
      cartoes={props.cartoes}
      cartaoPreSelecionadoId={props.tela?.cartaoId}
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
        >
          <Plus className="h-4 w-4" />
          Lançar pagamento
        </button>
      }
    />
  );

  if (!props.tela) {
    return (
      <CartaoCapa
        capa={props.capa}
        pending={pending}
        onAbrir={(id) => irPara(id)}
        lancarPagamento={lancarPagamento}
      />
    );
  }

  return (
    <CartaoFatura
      cartoes={props.cartoes}
      capa={props.capa}
      tela={props.tela}
      faturasDoCartao={props.faturasDoCartao}
      titulos={props.titulos}
      tipos={props.tipos}
      subtipos={props.subtipos}
      regionais={props.regionais}
      pending={pending}
      onVoltar={() => irPara(null)}
      onTrocarCartao={(id) => irPara(id)}
      onTrocarCompetencia={(c) => irPara(props.tela!.cartaoId, c)}
      lancarPagamento={lancarPagamento}
    />
  );
}
