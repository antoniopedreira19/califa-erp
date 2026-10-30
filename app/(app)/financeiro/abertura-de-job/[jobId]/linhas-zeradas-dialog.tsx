"use client";

/**
 * O aviso que vem antes da confirmação da revisão da abertura quando alguma
 * linha das previsões ficou com R$ 0,00 (Tiago, 30/10/2026: "para
 * continuar, a parcela zerada será apagada; se ele confirmar, segue para o
 * pop-up de confirmação"). Vale para a revisão da errata e para a revisão
 * junto com o "Editar planilha" — o registro não guarda linha sem valor.
 */

import * as React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { formatDataBr } from "../formatos";

export interface LinhaZerada {
  id: string;
  bloco: string;
  rotulo: string;
  data: string;
}

export function LinhasZeradasDialog({
  open,
  onOpenChange,
  linhas,
  onContinuar,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  linhas: LinhaZerada[];
  onContinuar: () => void;
}) {
  const uma = linhas.length === 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[470px]">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle className="pt-4 text-[19px]">
            {uma ? "Uma linha zerada será apagada" : `${linhas.length} linhas zeradas serão apagadas`}
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed">
            {uma
              ? "Esta linha das previsões está com R$ 0,00. Para registrar a revisão, ela é apagada; se você continuar, segue para a confirmação da revisão."
              : "Estas linhas das previsões estão com R$ 0,00. Para registrar a revisão, elas são apagadas; se você continuar, segue para a confirmação da revisão."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {linhas.map((l) => (
            <div key={`${l.bloco}-${l.id}`} className="flex items-end justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {l.bloco}
                </p>
                <p className="mt-0.5 text-[13px]">
                  <span className="font-semibold">{l.rotulo}</span>
                  <span className="ml-2 font-mono text-[12px] text-muted-foreground">
                    {l.data ? formatDataBr(l.data) : "sem data"}
                  </span>
                </p>
              </div>
              <span className="whitespace-nowrap font-mono text-[13px] font-semibold text-muted-foreground line-through">
                {formatCurrency(0)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
          >
            Voltar e revisar
          </button>
          <button
            type="button"
            onClick={onContinuar}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red-hover"
          >
            <Trash2 className="h-4 w-4" />
            Apagar e continuar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
