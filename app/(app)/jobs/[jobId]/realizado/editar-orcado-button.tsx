"use client";

/**
 * "Editar orçado" — o gatilho da edição do orçado pelo FINANCEIRO (decisão
 * 115), no mesmo lugar em que a produção tem o "Realizar errata". Mesma
 * forma e mesmo estado ligado do botão da errata (`AlterarOrcadoButton`):
 * as duas telas mostram a mesma planilha, e o botão muda só de nome.
 *
 * Travado — com o motivo no `title` — quando o job já tem nota emitida
 * (P4 do Tiago, 28/09/2026).
 */

import * as React from "react";
import { PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { ERRATA } from "@/app/(app)/_planilha/blocos";

interface Props {
  ativo: boolean;
  onAlternar: () => void;
  travadoPor?: string | null;
}

export function EditarOrcadoButton({ ativo, onAlternar, travadoPor }: Props) {
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
        travado && "cursor-not-allowed opacity-45 hover:border-border hover:bg-white",
      )}
    >
      <PencilLine className="h-3.5 w-3.5 text-california-red" />
      {ativo ? "Editando orçado" : "Editar orçado"}
    </button>
  );
}
