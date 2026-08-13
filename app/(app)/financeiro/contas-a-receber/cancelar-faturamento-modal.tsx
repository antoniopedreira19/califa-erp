"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelarFaturamento } from "./actions";

interface Props {
  faturamentoId: string;
  numeroNf: string;
  onClose: () => void;
  onDone: () => void;
  onErr: (msg: string) => void;
}

export function CancelarFaturamentoModal({
  faturamentoId,
  numeroNf,
  onClose,
  onDone,
  onErr,
}: Props) {
  const [motivo, setMotivo] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Cancelar NF ${numeroNf}?`}
      description={
        <div className="space-y-2">
          <p>
            Todos os títulos em aberto desta NF serão cancelados. Se algum
            título já foi baixado, o cancelamento é bloqueado (estorne primeiro).
          </p>
          <div>
            <label className="text-xs font-medium">Motivo * (mín. 10 caracteres)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded border border-border p-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {motivo.trim().length}/500 caracteres
            </p>
          </div>
        </div>
      }
      confirmLabel="Confirmar cancelamento"
      cancelLabel="Voltar"
      variant="destructive"
      pending={pending}
      onConfirm={() => {
        startTransition(async () => {
          const res = await cancelarFaturamento({ faturamento_id: faturamentoId, motivo });
          if (!res.ok) {
            onErr(res.message);
            return;
          }
          onDone();
        });
      }}
    />
  );
}
