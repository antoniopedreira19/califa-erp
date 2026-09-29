"use client";

/**
 * "Dar baixa" numa transferência entre contas que nasceu a transferir
 * (decisão 124). As contas e o valor são do título; aqui só se confirma a
 * data em que o dinheiro mudou de conta. Ao confirmar, as duas pernas
 * entram no extrato — a saída na origem e a entrada no destino.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowLeftRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { formatCurrency } from "@/lib/utils";

export interface TransferirAlvo {
  id: string;
  codigo: string;
  /** "Conta Teste · Teste → BB California · Banco do Brasil" */
  contas: string;
  descricao: string | null;
  valor: number;
  dataPrevista: string;
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function TransferirDialog({
  open,
  onOpenChange,
  alvo,
  pending,
  erro,
  onConfirmar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: TransferirAlvo | null;
  pending: boolean;
  erro: string | null;
  onConfirmar: (data: string) => void;
}) {
  const [data, setData] = React.useState("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const chave = alvo?.id ?? null;

  React.useEffect(() => {
    if (!open || !alvo) return;
    setData(alvo.dataPrevista);
    setErroLocal(null);
    // Só a troca de título reinicia: o objeto `alvo` é remontado a cada
    // renderização da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chave]);

  if (!alvo) return null;
  const mensagem = erro ?? erroLocal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-emerald-700" />
            Registrar a transferência
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
          <span className="text-muted-foreground">Transferência</span>
          <span className="font-mono font-bold">{alvo.codigo}</span>
          <span className="text-muted-foreground">Contas</span>
          <span className="font-semibold">{alvo.contas}</span>
          {alvo.descricao && (
            <>
              <span className="text-muted-foreground">Descrição</span>
              <span>{alvo.descricao}</span>
            </>
          )}
          <span className="text-muted-foreground">Data prevista</span>
          <span className="font-mono">{formatarData(alvo.dataPrevista)}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-bold">{formatCurrency(alvo.valor, "BRL")}</span>
        </div>

        {mensagem && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mensagem}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Data da transferência <span className="text-california-red">*</span>
          </label>
          <DatePicker
            key={alvo.id}
            name="data_transferencia"
            defaultValue={alvo.dataPrevista}
            onDateChange={(d) => {
              setData(d ? format(d, "yyyy-MM-dd") : "");
              setErroLocal(null);
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            As duas linhas entram no extrato nesta data: a saída na conta de origem e a
            entrada na de destino.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!data) {
                setErroLocal("Informe a data da transferência.");
                return;
              }
              onConfirmar(data);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <ArrowLeftRight className="h-4 w-4" />
            {pending ? "Registrando..." : "Registrar transferência"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
