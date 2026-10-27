"use client";

import * as React from "react";
import { History } from "lucide-react";
import { HistoricoNfModal } from "./historico-nf-modal";

/** Botão "Ver histórico" + modal — client wrapper isolado para não contaminar o
 *  server component QuadroNf com estado de UI. */
export function QuadroNfHistorico({ colaboradorId }: { colaboradorId: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
      >
        <History className="h-4 w-4" />
        Ver histórico
      </button>
      {open && (
        <HistoricoNfModal
          colaboradorId={colaboradorId}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
