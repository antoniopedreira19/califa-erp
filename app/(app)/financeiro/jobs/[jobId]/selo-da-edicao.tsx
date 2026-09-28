"use client";

/**
 * O selo "Somente leitura" do cabeçalho do job no financeiro. Durante o
 * "Editar orçado" (decisão 115) ele vira "Editando orçado": dizer "somente
 * leitura" com a planilha aberta para edição seria mentira — a mesma razão
 * pela qual a revisão da abertura já troca o selo (decisão 059).
 *
 * Quem liga o modo é a `JobRealizadoSection`, pelo store de
 * `modo-errata.ts` — o cabeçalho é irmão das abas e não recebe props dela.
 */

import { FilePenLine, Lock } from "lucide-react";
import { useModoErrataAtivo } from "@/app/(app)/jobs/[jobId]/modo-errata";

export function SeloDaEdicao() {
  const editando = useModoErrataAtivo();
  if (editando) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-california-red/30 bg-california-red/[0.06] px-3 py-1 text-[11px] font-semibold text-california-red">
        <FilePenLine className="h-3 w-3" />
        Editando orçado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11px] font-semibold text-muted-foreground">
      <Lock className="h-3 w-3" />
      Somente leitura
    </span>
  );
}
