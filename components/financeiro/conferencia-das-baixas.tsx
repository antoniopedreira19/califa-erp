"use client";

/**
 * "Ver as baixas registradas" de um título a pagar ou a receber (decisões
 * 120 e 125): o `BaixaRegistradaDialog` com o cancelar e o estornar, no
 * mesmo jeito de Títulos a Pagar e de Títulos a Receber. Mora aqui desde a
 * decisão 195 porque a planilha de títulos da conciliação também abre a
 * conferência pelo ⓘ — e as duas listas e a conciliação não podem divergir
 * em qual baixa se cancela pelo documento e qual pela baixa.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BaixaRegistradaDialog,
  type BaixaRegistradaAlvo,
} from "@/components/financeiro/baixa-registrada-dialog";
import { cancelarBaixa, estornarValorDaBaixa } from "@/app/(app)/financeiro/actions-baixa-registrada";
import type { TituloRow as TituloAPagar } from "@/app/(app)/financeiro/contas-a-pagar/titulos-pagar-list";
import type { TituloRow as TituloAReceber } from "@/app/(app)/financeiro/contas-a-receber/titulos-list";

export type TituloConferido =
  | { lado: "pagar"; t: TituloAPagar }
  | { lado: "receber"; t: TituloAReceber };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Por que a baixa a pagar não aceita estorno (decisão 120). O estorno é
 * dinheiro que volta para uma conta bancária: a fatura de cartão não tem
 * (cancelar é o caminho), e o item pago no cartão já tem o "Estornar
 * compra", na fatura.
 */
export function motivoSemEstornoAPagar(r: TituloAPagar): string | null {
  if (r.origem === "fatura_cartao") {
    return "Pagamento de fatura não tem estorno. Se foi lançado errado, cancele a baixa.";
  }
  if (r.forma_pagamento === "cartao_credito") {
    return "Pago no cartão: para devolver, use Estornar compra, na fatura do cartão.";
  }
  return null;
}

export function alvoDaConferenciaAPagar(t: TituloAPagar): BaixaRegistradaAlvo {
  return {
    titulo: t.descricao,
    origem:
      t.origem === "pp"
        ? `Pedido de produção ${t.origem_label}`
        : t.origem === "recorrencia"
          ? `Recorrência · ${t.descricao}`
          : t.origem === "desembolso"
            ? `Desembolso ${t.origem_label}`
            : t.origem === "pp_devolucao_verba"
              ? `Estorno de verba ${t.origem_label.replace(/^ESTORNO /, "")}`
              : t.origem === "fatura_cartao"
                ? `Fatura de cartão ${t.origem_label}`
                : t.origem === "folha"
                  ? "Folha de pagamento"
                  : "Lançamento avulso",
    parcela: `${t.parcela_numero}/${t.parcela_total}`,
    valor: t.valor,
    vencOriginal: t.venc_original,
    // As baixas do documento (decisão 125). A fatura de cartão não tem um
    // lançamento só (duas pernas): a baixa dela sai dos campos de uma baixa
    // só, e cancela pela fatura.
    baixas:
      t.baixas.length > 0
        ? t.baixas
        : [
            {
              lancamentoId: t.baixa_lancamento_id,
              data: t.pago_em,
              contaNome: t.conta_nome,
              contaBancariaId: t.baixa_conta_id,
              centroNome: t.centro_nome,
              subtipoNome: t.subtipo_nome,
              movimentado: t.valor,
              retencoes: [],
              estornos: t.estornos_da_baixa,
              antesDaNf: false,
            },
          ],
    viaCartao: t.forma_pagamento === "cartao_credito",
    ehFaturaDeCartao: t.origem === "fatura_cartao",
    ehTransferencia: false,
    semEstorno: motivoSemEstornoAPagar(t),
  };
}

export function alvoDaConferenciaAReceber(t: TituloAReceber): BaixaRegistradaAlvo {
  return {
    titulo: t.origem === "nf" ? `NF ${t.fat_numero_nf} — ${t.fat_descricao}` : `${t.codigo_avulsa ?? ""} — ${t.fat_descricao}`,
    origem:
      t.origem === "nf"
        ? t.jobs_cobertos.join(" · ") || t.contraparte_nome
        : t.origem === "rendimento"
          ? `Rendimento de aplicação · ${t.contraparte_nome}`
          : t.origem === "transferencia"
            ? `Transferência entre contas · ${t.contraparte_nome}`
            : t.contraparte_nome === "—"
              ? "Recebimento avulso"
              : `Recebimento avulso · ${t.contraparte_nome}`,
    parcela: `${t.numero_parcela}/${t.total_parcelas}`,
    valor: t.valor,
    vencOriginal: t.data_vencimento,
    baixas: t.baixas,
    // Recebimento nunca é no cartão, nem pagamento de fatura.
    viaCartao: false,
    ehFaturaDeCartao: false,
    ehTransferencia: t.origem === "transferencia",
    // Rendimento não tem estorno (D16): errou, cancela.
    semEstorno:
      t.origem === "rendimento"
        ? "Rendimento de aplicação não tem estorno. Se foi lançado errado, cancele a baixa."
        : t.origem === "transferencia"
          ? "Transferência entre contas não tem estorno. Se foi lançada errado, cancele a baixa."
          : null,
  };
}

export function ConferenciaDasBaixas({
  conferindo,
  onFechar,
  contas,
  onDarBaixaNoRestante,
  onConcluido,
}: {
  conferindo: TituloConferido | null;
  onFechar: () => void;
  contas: Array<{ id: string; nome: string; banco: string }>;
  onDarBaixaNoRestante: (c: TituloConferido) => void;
  onConcluido: (mensagem: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const alvo = conferindo
    ? conferindo.lado === "pagar"
      ? alvoDaConferenciaAPagar(conferindo.t)
      : alvoDaConferenciaAReceber(conferindo.t)
    : null;

  function fechar() {
    setErro(null);
    onFechar();
  }

  return (
    <BaixaRegistradaDialog
      open={conferindo !== null}
      onOpenChange={(o) => {
        if (!o) fechar();
      }}
      alvo={alvo}
      contas={contas}
      pending={pending}
      erro={erro}
      sentido={conferindo?.lado === "receber" ? "receber" : "pagar"}
      onDarBaixaNoRestante={() => {
        if (!conferindo) return;
        fechar();
        onDarBaixaNoRestante(conferindo);
      }}
      onCancelar={(baixa, motivo) => {
        const c = conferindo;
        if (!c) return;
        startTransition(async () => {
          let mensagem: string;
          if (c.lado === "pagar") {
            const t = c.t;
            // PP, avulso, recorrência e folha cancelam AQUELA baixa (decisão
            // 125); desembolso, devolução de verba e fatura têm uma baixa só e
            // cancelam pelo documento.
            const porBaixa =
              baixa.lancamentoId !== null &&
              (t.origem === "pp" || t.origem === "avulso" || t.origem === "recorrencia" || t.origem === "folha");
            const res = porBaixa
              ? await cancelarBaixa({ tipo: "baixa", id: baixa.lancamentoId, motivo })
              : await cancelarBaixa({ tipo: t.origem, id: t.id, motivo });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            const sobraBaixa = porBaixa && t.baixas.length > 1;
            mensagem =
              t.origem === "fatura_cartao"
                ? `Pagamento cancelado · a fatura ${t.origem_label} voltou para Fechada.`
                : `Baixa cancelada · ${formatMoney(baixa.movimentado)} saíram do extrato e o título voltou para ${sobraBaixa ? "Parcial" : "A pagar"}.`;
          } else {
            const t = c.t;
            // A transferência não tem um lançamento só: cancela pelo título.
            // As outras cancelam aquela baixa (decisão 125).
            const res =
              t.origem === "transferencia" || !baixa.lancamentoId
                ? await cancelarBaixa({ tipo: "transferencia", id: t.id, motivo })
                : await cancelarBaixa({ tipo: "baixa", id: baixa.lancamentoId, motivo });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            const referencia =
              t.origem === "nf" ? `NF ${t.fat_numero_nf} ${t.numero_parcela}/${t.total_parcelas}` : (t.codigo_avulsa ?? "o título");
            mensagem =
              t.origem === "transferencia"
                ? `Transferência cancelada · ${t.codigo_avulsa ?? ""} voltou para A transferir, e as duas linhas saíram do extrato.`
                : `Baixa cancelada · ${referencia} voltou para ${t.baixas.length > 1 ? "Parcial" : "Em aberto"} e ${formatMoney(baixa.movimentado)} saíram do extrato.`;
          }
          fechar();
          onConcluido(mensagem);
          router.refresh();
        });
      }}
      onEstornar={(baixa, dados) => {
        const c = conferindo;
        if (!c || !baixa.lancamentoId) return;
        const lancamentoId = baixa.lancamentoId;
        startTransition(async () => {
          const res = await estornarValorDaBaixa({
            lancamento_id: lancamentoId,
            data: dados.data,
            conta_bancaria_id: dados.contaBancariaId,
            valor: dados.valor,
            motivo: dados.motivo,
          });
          if (!res.ok) {
            setErro(res.message);
            return;
          }
          const voltou =
            c.lado === "pagar" && c.t.origem !== "pp_devolucao_verba" ? "voltou para a" : "saiu da";
          fechar();
          onConcluido(
            `Estorno registrado · ${formatMoney(dados.valor)} ${voltou} conta em ${formatDate(dados.data)}. A baixa continua como está.`,
          );
          router.refresh();
        });
      }}
    />
  );
}
