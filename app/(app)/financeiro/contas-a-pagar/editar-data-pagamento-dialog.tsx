"use client";

/**
 * Pop-up do lápis da coluna "Data de pagamento" (Tela 3.2).
 *
 * A repactuação não apaga o passado: o **vencimento original** (o prazo
 * que a produção negociou, ou a data informada na criação da avulsa) e a
 * **1ª data de pagamento** ficam registrados e em evidência para sempre.
 * A primeira é congelada por trigger no banco — não é promessa de tela.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, Check, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";

export interface EditarDataAlvo {
  titulo: string;
  origem: string;
  vencOriginal: string | null;
  primeiraData: string | null;
  dataAtual: string | null;
}

export function EditarDataPagamentoDialog({
  open,
  onOpenChange,
  alvo,
  pending,
  erro,
  onSalvar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: EditarDataAlvo | null;
  pending: boolean;
  erro: string | null;
  onSalvar: (novaData: string) => void;
}) {
  const [data, setData] = React.useState<string>("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !alvo) return;
    setData(alvo.dataAtual ?? "");
    setErroLocal(null);
  }, [open, alvo]);

  if (!alvo) return null;
  const mensagemErro = erro ?? erroLocal;
  const hoje = format(new Date(), "dd/MM/yyyy");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-california-red" />
            Editar data de pagamento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-0.5">
          <p className="text-sm font-semibold">{alvo.titulo}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{alvo.origem}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
              Vencimento original
            </p>
            <p className="mt-1 font-mono text-base font-bold">
              {alvo.vencOriginal ? formatarData(alvo.vencOriginal) : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
              1ª data de pagamento
            </p>
            <p className="mt-1 font-mono text-base font-bold">
              {alvo.primeiraData ? formatarData(alvo.primeiraData) : "—"}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground text-pretty">
          Ambas ficam registradas para sempre — a edição altera apenas a data de
          pagamento vigente.
        </p>

        {mensagemErro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Nova data de pagamento <span className="text-california-red">*</span>
          </label>
          <DatePicker
            name="data_pagamento"
            defaultValue={data || undefined}
            onDateChange={(d) => {
              setData(d ? format(d, "yyyy-MM-dd") : "");
              setErroLocal(null);
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Hoje é{" "}
            <strong className="font-semibold text-california-red">{hoje}</strong> —
            destacado no calendário.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!data) {
                setErroLocal("Escolha a nova data de pagamento.");
                return;
              }
              onSalvar(data);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {pending ? "Salvando..." : "Salvar data"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
