"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Stub — preenchido na Task 5. */
export function DialogAnexarReciboContabil(_props: {
  aberto: boolean;
  folhaId: string;
  valorBasePreview: number | null;
  rotulo: string;
  onFechar: () => void;
}) {
  return (
    <Dialog open={_props.aberto} onOpenChange={(v) => !v && _props.onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anexar recibo da contabilidade</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Em implementação.
        </p>
      </DialogContent>
    </Dialog>
  );
}
