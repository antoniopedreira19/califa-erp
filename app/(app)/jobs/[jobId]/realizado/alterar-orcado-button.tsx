"use client";

/**
 * O gatilho do modo errata.
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
}

export function AlterarOrcadoButton({ ativo, onAlternar }: Props) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-pressed={ativo}
      className={cn(
        ativo
          ? ERRATA.botaoAtivo
          : "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06]",
      )}
    >
      <PencilLine className="h-3.5 w-3.5 text-california-red" />
      {ativo ? "Alterando orçado" : "Alterar orçado"}
    </button>
  );
}
