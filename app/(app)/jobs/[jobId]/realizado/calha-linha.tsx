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
 *  para a calha desenhar uma pílula inteira ou uma dividida.
 *
 *  O "Ver PP" que abria o PDF direto daqui saiu em 17/08/2026: com PPs
 *  parciais um item tem VÁRIAS PPs, e a calha não tem como escolher qual
 *  PDF abrir. A metade virou o chip "PPs · N", que abre o painel
 *  "Destrinchar realizado" — é lá que cada PP tem o seu "Ver PP".
 */

import { FilePlus, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PedidoCompra } from "@/lib/types";
import {
  CalhaAcoes,
  type AcaoCalha,
} from "@/app/(app)/_planilha/calha-acoes";

export interface DadosPpLinha {
  itemRealizadoId: string;
  /** Todas as PPs ativas do item — desde 17/08/2026 podem ser várias. */
  pedidos: PedidoCompra[];
  /** Quantas dessas ainda estão GERADAS, sem envio ao financeiro. Vira o
   *  círculo vermelho no canto do chip (02/09/2026). */
  pendentes: number;
  /** Placeholder otimista antes do refresh do server chegar. Só tem
   *  `codigo`. Some quando a PP real chega via prop. */
  otimista: { codigo: string } | null;
  /** Abre o painel "Destrinchar realizado" do item. */
  onAbrirPainel: (itemRealizadoId: string) => void;
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
  const acoes: AcaoCalha[] = [];
  if (bv) acoes.push(bv);

  const acaoPp = descreverPp(pp);
  if (acaoPp) acoes.push(acaoPp);

  return (
    <div className={cn("relative flex items-center", altura)}>
      <CalhaAcoes acoes={acoes} />
    </div>
  );
}

/** Regra de quando a PP aparece — e o que a metade faz.
 *
 *  Quem decide se a linha tem PP é o TIPO de custo, na tabela. Aqui não
 *  há mais filtro por valor: até 02/09/2026 item com orçado zero escondia
 *  a metade, o que deixava a linha vermelha — que nasce zerada de
 *  propósito — sem caminho nenhum para a PP que é a única coisa que ela
 *  faz. Com o teto por PP fora, o valor do item não decide mais nada.
 *
 *  Desde 17/08/2026 os dois caminhos levam ao MESMO lugar: o painel
 *  "Destrinchar realizado". Um item pode ter várias PPs, então "Ver PP"
 *  não sabia mais qual PDF abrir — quem escolhe é o painel, que lista
 *  todas. O que muda é só o rótulo: sem PP é criação ("Gerar PP", em
 *  vermelho); com PP é consulta ("PPs · N", neutro), como o design pede.
 *
 *  O chip carrega o contador de PPs geradas e ainda não enviadas ao
 *  financeiro (02/09/2026) — as pendências ficam visíveis sem abrir o
 *  painel. Zerado, o círculo não aparece. */
function descreverPp(pp: DadosPpLinha | null): AcaoCalha | null {
  if (!pp) return null;

  const quantas = pp.pedidos.length + (pp.otimista ? 1 : 0);
  // A PP otimista acabou de ser gerada: é pendência até o refresh trazer
  // a linha real.
  const pendentes = pp.pendentes + (pp.otimista ? 1 : 0);
  const abrir = () => pp.onAbrirPainel(pp.itemRealizadoId);

  if (quantas > 0) {
    const base =
      quantas === 1
        ? "1 Pedido de Produção neste item"
        : `${quantas} Pedidos de Produção neste item`;
    return {
      chave: "pp",
      rotulo: `PPs · ${quantas}`,
      sigla: `PP·${quantas}`,
      titulo:
        pendentes > 0
          ? `${base} · ${pendentes} aguardando envio ao financeiro`
          : base,
      icone: Eye,
      criar: false,
      onClick: abrir,
      badge: pendentes,
    };
  }

  return {
    chave: "pp",
    rotulo: "Gerar PP",
    sigla: "PP",
    titulo: "Gerar PP",
    icone: FilePlus,
    criar: true,
    onClick: abrir,
  };
}
