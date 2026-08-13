"use client";

/** A calha de UMA linha da planilha do job.
 *
 *  Antes deste arquivo existia o `pp-actions-cell`, que só sabia de PP,
 *  porque BV e PP nunca dividiam a linha: o tipo de custo escolhia um dos
 *  dois. O A · Repasse acabou com essa exclusividade (13/08/2026) — nele
 *  o principal passa pela California e vira Pedido de Produção, e ainda
 *  há comissão a negociar com o fornecedor, que é o BV.
 *
 *  Quem decide o QUE aparece é a tabela (ela é quem conhece o tipo de
 *  custo). Este componente decide COMO: junta as ações da linha e entrega
 *  para a calha desenhar uma pílula inteira ou uma dividida. Também é
 *  dele o estado do "Ver PP", que abre o PDF por URL assinada.
 */

import * as React from "react";
import { FilePlus, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PedidoCompra } from "@/lib/types";
import {
  CalhaAcoes,
  type AcaoCalha,
} from "@/app/(app)/_planilha/calha-acoes";
import { signedUrlPdf } from "./actions-pp";

export interface DadosPpLinha {
  itemRealizadoId: string;
  totalRealizado: number;
  pedido: PedidoCompra | null;
  /** Placeholder otimista antes do refresh do server chegar. Só tem
   *  `codigo` — a metade fica disabled porque ainda não temos o id para
   *  chamar a action. Some quando a PP real chega via prop. */
  otimista: { codigo: string } | null;
  onGerar: (itemRealizadoId: string) => void;
}

export function CalhaLinha({
  altura,
  bv,
  pp,
}: {
  /** Altura da linha da tabela — a calha precisa acompanhar pra alinhar.
   *  Vem de quem desenha a linha, que é onde a altura é decidida. */
  altura: string;
  /** Ação de BV da linha. Null quando o tipo não aceita BV, ou quando não
   *  há BV lançado numa tela congelada. */
  bv: AcaoCalha | null;
  /** Dados da PP. Null quando o tipo não emite PP ou a tela está
   *  congelada. */
  pp: DadosPpLinha | null;
}) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const pedido = pp?.pedido ?? null;

  function verPdf() {
    if (!pedido) return;
    startTransition(async () => {
      const res = await signedUrlPdf(pedido!.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  const acoes: AcaoCalha[] = [];
  if (bv) acoes.push(bv);

  const acaoPp = descreverPp(pp, pedido, pending, verPdf);
  if (acaoPp) acoes.push(acaoPp);

  return (
    <div className={cn("relative flex items-center", altura)}>
      <CalhaAcoes acoes={acoes} />
      {erro && (
        <div
          className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded border border-california-red/40 bg-white px-2 py-1 text-[10px] text-california-red shadow"
          onClick={() => setErro(null)}
        >
          {erro}
        </div>
      )}
    </div>
  );
}

/** Regra de quando a PP aparece — a mesma de sempre, só extraída.
 *
 *  Sem realizado lançado não há o que pedir: a PP nasce do valor
 *  realizado da linha, então a metade só entra depois que ele existe. Em
 *  A · Repasse isso significa que a linha começa com a pílula inteira do
 *  BV e SE DIVIDE quando o realizado é lançado. */
function descreverPp(
  pp: DadosPpLinha | null,
  pedido: PedidoCompra | null,
  pending: boolean,
  onVer: () => void,
): AcaoCalha | null {
  if (!pp) return null;
  if (pp.totalRealizado <= 0) return null;

  // Com PP: só visualizar. Cancelar mora na aba de Pedidos de Produção.
  if (pedido) {
    return {
      chave: "pp",
      rotulo: "Ver PP",
      sigla: "PP",
      titulo: `Ver PDF · ${pedido.codigo}`,
      icone: Eye,
      criar: false,
      disabled: pending,
      onClick: onVer,
    };
  }

  // PP recém-gerada, aguardando o refresh do server trazer o id real.
  if (pp.otimista) {
    return {
      chave: "pp",
      rotulo: "Ver PP",
      sigla: "PP",
      titulo: `Ver PDF · ${pp.otimista.codigo} (atualizando...)`,
      icone: Eye,
      criar: false,
      disabled: true,
    };
  }

  return {
    chave: "pp",
    rotulo: "Gerar PP",
    sigla: "PP",
    titulo: "Gerar PP",
    icone: FilePlus,
    criar: true,
    onClick: () => pp.onGerar(pp.itemRealizadoId),
  };
}
