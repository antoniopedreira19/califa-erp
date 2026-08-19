"use client";

/**
 * Pop-up do lápis da coluna Vencimento (Tela 3.3).
 *
 * A tela promete duas coisas ao usuário, e as duas são garantidas no
 * banco, não aqui:
 *
 * - **O vencimento da NF nunca muda.** É o que a nota diz.
 * - **A 1ª previsão registrada fica para sempre.**
 *
 * As duas são congeladas pelo trigger
 * `congela_previsao_recebimento_primeira` — qualquer update que tente
 * sobrescrevê-las é revertido, venha da tela ou de fora dela.
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

export interface EditarPrevisaoAlvo {
  numeroNf: string;
  parcela: string;
  cliente: string;
  vencimento: string;
  primeiraPrevisao: string;
  previsaoAtual: string;
}

export function EditarPrevisaoDialog({
  open,
  onOpenChange,
  alvo,
  pending,
  erro,
  onSalvar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: EditarPrevisaoAlvo | null;
  pending: boolean;
  erro: string | null;
  onSalvar: (novaData: string) => void;
}) {
  const [data, setData] = React.useState("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !alvo) return;
    setData(alvo.previsaoAtual);
    setErroLocal(null);
  }, [open, alvo]);

  if (!alvo) return null;
  const mensagemErro = erro ?? erroLocal;
  const hoje = format(new Date(), "dd/MM/yyyy");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[470px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-california-red" />
            Editar previsão de recebimento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-0.5">
          <p className="text-sm font-semibold">
            NF {alvo.numeroNf} · parcela {alvo.parcela}
          </p>
          <p className="text-[11.5px] text-muted-foreground">{alvo.cliente}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-amber-800">
              Vencimento da NF
            </p>
            <p className="mt-1 font-mono text-base font-bold">
              {formatarData(alvo.vencimento)}
            </p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-blue-700">
              1ª previsão registrada
            </p>
            <p className="mt-1 font-mono text-base font-bold">
              {formatarData(alvo.primeiraPrevisao)}
            </p>
          </div>
        </div>
        <p className="text-[11.5px] text-muted-foreground text-pretty">
          O vencimento da nota nunca muda — a edição altera apenas a previsão de
          recebimento usada no fluxo de caixa.
        </p>

        {mensagemErro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Nova previsão de recebimento{" "}
            <span className="text-california-red">*</span>
          </label>
          <DatePicker
            name="data_previsao_recebimento"
            defaultValue={data || undefined}
            onDateChange={(d) => {
              setData(d ? format(d, "yyyy-MM-dd") : "");
              setErroLocal(null);
            }}
          />
          <p className="text-[11.5px] text-muted-foreground">
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
                setErroLocal("Informe a nova previsão de recebimento.");
                return;
              }
              onSalvar(data);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {pending ? "Salvando..." : "Salvar previsão"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatarData(iso: string): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
