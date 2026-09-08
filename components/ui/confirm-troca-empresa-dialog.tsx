"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ConfirmTrocaEmpresaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  contexto?: "rateio" | "regionais_aliadas";
};

/**
 * Confirmação de troca de empresa quando há dados dependentes que
 * ficarão inválidos (rateio de regionais ou lista de regionais
 * aliadas — todas pertencem à empresa atual e não podem coexistir
 * com a nova).
 */
export function ConfirmTrocaEmpresaDialog(props: ConfirmTrocaEmpresaDialogProps) {
  const { open, onOpenChange, onConfirm, contexto = "rateio" } = props;

  const descricao =
    contexto === "rateio"
      ? "As regionais do rateio pertencem à empresa atual. Trocar a empresa vai limpar o rateio."
      : "As regionais escolhidas pertencem à empresa atual e não podem coexistir com a nova. Trocar a empresa vai limpar a seleção.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trocar empresa?</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
