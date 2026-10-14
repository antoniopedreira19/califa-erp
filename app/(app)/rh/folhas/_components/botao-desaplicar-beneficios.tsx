"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { desaplicarBeneficios } from "@/lib/actions/beneficios/fechamento";

export function BotaoDesaplicarBeneficios(props: { fechamentoId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  function confirmar() {
    setErro(null);
    startTransition(async () => {
      const r = await desaplicarBeneficios({ fechamentoId: props.fechamentoId });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErro(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Desaplicar
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!pending) setOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-muted-foreground" />
              Desaplicar descontos de benefícios
            </DialogTitle>
            <DialogDescription>
              Esta ação reverte o fechamento desta competência.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <p>Vai acontecer:</p>
            <ul className="space-y-1.5 pl-4 list-disc text-sm">
              <li>Reverte a redução de salário nas linhas PJ.</li>
              <li>Apaga as avulsas de benefícios já geradas (se o Enviar ao financeiro já rolou).</li>
              <li>Marca a competência como reaberta no histórico.</li>
            </ul>

            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Só funciona se nenhuma avulsa de benefício foi paga. Se alguma
                já foi, estorne pelo financeiro antes.
              </span>
            </div>
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
              {pending ? "Desaplicando..." : "Desaplicar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
