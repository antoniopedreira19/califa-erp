"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function DrawerColaboradorBeneficios({
  colaboradorId,
  ano,
  mes,
  onClose,
}: {
  colaboradorId: string;
  ano: number;
  mes: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Benefícios do colaborador</DialogTitle>
          <DialogDescription>
            Competência {String(mes).padStart(2, "0")}/{ano}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          Em breve (S4): vínculos, dependentes e breakdown do cálculo mensal.
          <div className="mt-2 text-xs">colaboradorId: {colaboradorId}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
