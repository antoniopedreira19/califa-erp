"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { aprovarDesembolsoComData } from "@/app/(app)/financeiro/desembolsos/actions";
import type { DesembolsoStatus } from "@/lib/types";

export interface DesembolsoParaAprovar {
  id: string;
  codigo: string;
  descricao: string;
  valor: number;
  status: DesembolsoStatus;
  fornecedor_nome: string;
}

interface AprovarDesembolsoDialogProps {
  desembolso: DesembolsoParaAprovar | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AprovarDesembolsoDialog({
  desembolso,
  open,
  onOpenChange,
}: AprovarDesembolsoDialogProps) {
  const router = useRouter();
  const [dataPagamento, setDataPagamento] = React.useState(hoje());
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  // Resetar data ao abrir
  React.useEffect(() => {
    if (open) {
      setDataPagamento(hoje());
      setErro(null);
    }
  }, [open]);

  async function handleConfirmar() {
    if (!desembolso) return;
    setPending(true);
    setErro(null);
    const res = await aprovarDesembolsoComData({
      desembolso_id: desembolso.id,
      data_pagamento: dataPagamento,
    });
    setPending(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  if (!desembolso) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aprovar desembolso</DialogTitle>
          <DialogDescription>
            Informe a data de pagamento para aprovar o desembolso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Resumo */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
            <p>
              <span className="font-mono font-bold text-california-red">{desembolso.codigo}</span>
              {" — "}
              <span className="font-semibold">{formatMoney(desembolso.valor)}</span>
            </p>
            <p className="text-muted-foreground">{desembolso.descricao}</p>
            {desembolso.fornecedor_nome && (
              <p className="text-muted-foreground">Fornecedor: {desembolso.fornecedor_nome}</p>
            )}
          </div>

          {/* Data de pagamento */}
          <div className="space-y-1.5">
            <Label htmlFor="data-pagamento-desembolso">Data de pagamento</Label>
            <Input
              id="data-pagamento-desembolso"
              type="date"
              value={dataPagamento}
              onChange={(e) => setDataPagamento(e.target.value)}
              min="2020-01-01"
              max="2099-12-31"
            />
          </div>

          {/* Erro */}
          {erro && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={pending || !dataPagamento}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {pending ? "Aprovando…" : "Confirmar aprovação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
