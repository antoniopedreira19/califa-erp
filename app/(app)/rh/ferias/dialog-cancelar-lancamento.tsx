"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FeriasLancamentoStatus } from "@/lib/types";
import { cancelarLancamento } from "./actions";

export function DialogCancelarLancamento({
  aberto,
  lancamentoId,
  statusLancamento,
  onFechar,
  onCancelado,
}: {
  aberto: boolean;
  lancamentoId: string;
  statusLancamento: FeriasLancamentoStatus;
  onFechar: () => void;
  onCancelado?: () => void;
}) {
  const router = useRouter();
  const [observacao, setObservacao] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (aberto) {
      setObservacao("");
      setErro(null);
    }
  }, [aberto, lancamentoId]);

  const temFolhas =
    statusLancamento === "aprovado" || statusLancamento === "nf_anexada";

  function handleConfirmar() {
    setErro(null);
    startTransition(async () => {
      const res = await cancelarLancamento(lancamentoId, {
        observacao: observacao.trim() || undefined,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onFechar();
      onCancelado?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !pending && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar solicitação</DialogTitle>
          <DialogDescription>
            Essa ação volta os dias do aquisitivo pro colaborador. Ele
            poderá solicitar de novo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {temFolhas && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Essa solicitação já tinha folhas de pagamento em rascunho —
                elas serão removidas junto.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="observacao-cancelar">
              Observação (opcional)
            </Label>
            <Textarea
              id="observacao-cancelar"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: colaborador pediu pra remarcar"
              rows={3}
              maxLength={500}
            />
          </div>

          {erro && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {erro}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onFechar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            {pending ? "Cancelando..." : "Confirmar cancelamento"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
