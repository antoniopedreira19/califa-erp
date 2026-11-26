"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Stub — preenchido na Task 6. */
export function DialogConfirmarEnvioFinanceiro(_props: {
  aberto: boolean;
  lancamentoId: string;
  totalFolhasRascunho: number;
  valorTotal: number;
  dataPagamentoDefault: string;
  onFechar: () => void;
}) {
  return (
    <Dialog open={_props.aberto} onOpenChange={(v) => !v && _props.onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar ao financeiro</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Em implementação.
        </p>
      </DialogContent>
    </Dialog>
  );
}
