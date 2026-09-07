"use client";

/**
 * O gatilho do modo errata.
 *
 * ⚠️ 07/09/2026: o rótulo passou de "Alterar orçado" para "Realizar
 * errata" (pedido do Tiago). A errata deixou de ser só do orçado — ela
 * abre o planejado da linha cujo orçado mudou (decisão 054) —, e o nome
 * antigo prometia menos do que o botão faz. O arquivo e o componente
 * mantêm o nome antigo de propósito: renomear os dois arrastaria a
 * seção, o handoff e o histórico do git por uma mudança de rótulo.
 *
 * ⚠️ Até 27/08/2026 este botão abria um drawer com uma SEGUNDA tabela, na
 * qual se editava o orçado longe da planilha. Ele agora só liga e desliga
 * o modo errata na planilha que já está na tela — o estado mora em
 * `JobRealizadoSection`, porque a barra do rodapé e o card de Totais
 * precisam do mesmo rascunho.
 */

import * as React from "react";
import { PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { ERRATA } from "@/app/(app)/_planilha/blocos";

interface Props {
  ativo: boolean;
  onAlternar: () => void;
  /** Motivo pelo qual a errata não pode abrir. Presente ⇒ botão travado,
   *  com o motivo no `title`. Hoje só existe um: o envio para faturamento
   *  já congelou o valor da nota (decisão 028, nota de 27/08/2026). */
  travadoPor?: string | null;
}

export function AlterarOrcadoButton({ ativo, onAlternar, travadoPor }: Props) {
  const travado = Boolean(travadoPor);
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-pressed={ativo}
      disabled={travado}
      title={travadoPor ?? undefined}
      className={cn(
        ativo
          ? ERRATA.botaoAtivo
          : "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06]",
        travado &&
          "cursor-not-allowed opacity-45 hover:border-border hover:bg-white",
      )}
    >
      <PencilLine className="h-3.5 w-3.5 text-california-red" />
      {ativo ? "Realizando errata" : "Realizar errata"}
    </button>
  );
}
