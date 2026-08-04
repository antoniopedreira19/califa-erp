"use client";

import * as React from "react";
import { PencilLine, X } from "lucide-react";
import type { ItemPlanilhaJob, VersaoOrcamentoGrupo } from "@/lib/types";
import { AlterarOrcadoDrawer } from "./alterar-orcado-drawer";

interface Props {
  jobId: string;
  itens: ItemPlanilhaJob[];
  grupos: VersaoOrcamentoGrupo[];
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

export function AlterarOrcadoButton(props: Props) {
  const [open, setOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06]"
      >
        <PencilLine className="h-3.5 w-3.5 text-california-red" />
        Alterar orçado
      </button>

      <AlterarOrcadoDrawer
        {...props}
        open={open}
        onOpenChange={setOpen}
        onSuccess={() =>
          setToast("Errata registrada e orçado atualizado.")
        }
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <span className="text-sm font-medium text-emerald-800">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
