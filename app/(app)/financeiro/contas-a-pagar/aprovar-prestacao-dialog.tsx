"use client";

/**
 * O pop-up que aprova a prestação de contas da verba (decisão 081).
 *
 * Irmão do `AprovarPPDialog`: aqui também só entra decisão. A conferência —
 * documentos ao lado da PP, valores, quem enviou — acontece na tela de
 * trás. O que se decide é se aprova e, havendo saldo, quando o dinheiro
 * deve voltar: essa data vira a do estorno de verba em Títulos a Pagar.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { formatCurrency } from "@/lib/utils";
import { aprovarPrestacaoVerba } from "./prestacao-verba-actions";

export interface PrestacaoParaAprovar {
  /** Id da PP de verba. */
  id: string;
  codigo: string;
  valor: number;
  gasto: number;
  saldo: number;
  documentos: number;
  /** Nome do tipo do plano de contas da PP — o do estorno. */
  centroDeCusto: string;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function AprovarPrestacaoDialog({
  open,
  onOpenChange,
  prestacao,
  onAprovada,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  prestacao: PrestacaoParaAprovar | null;
  onAprovada: (mensagem: string) => void;
}) {
  const [dataPrevista, setDataPrevista] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setDataPrevista("");
    setErro(null);
  }, [open, prestacao?.id]);

  if (!prestacao) return null;
  const alvo = prestacao;
  const temSaldo = alvo.saldo > 0;
  const brl = (n: number) => formatCurrency(n, "BRL");

  function aprovar() {
    if (temSaldo && !dataPrevista) {
      setErro("Escolha a data prevista da devolução antes de aprovar.");
      return;
    }
    startTransition(async () => {
      const res = await aprovarPrestacaoVerba({
        pp_id: alvo.id,
        data_prevista: temSaldo ? dataPrevista : null,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onAprovada(
        temSaldo
          ? `Prestação de ${alvo.codigo} aprovada · estorno de verba de ${brl(alvo.saldo)} para ${formatDate(dataPrevista)}.`
          : `Prestação de ${alvo.codigo} aprovada · a verba foi toda comprovada.`,
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `z-[60]`: aberto de dentro da tela cheia da PP, que está em `z-[55]`. */}
      <DialogContent className="z-[60] max-w-md" overlayClassName="z-[60]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-2">
            <span>Aprovar prestação</span>
            <span className="font-mono text-california-red">{alvo.codigo}</span>
          </DialogTitle>
          <DialogDescription>
            Verba de {brl(alvo.valor)} · {alvo.documentos}{" "}
            {alvo.documentos === 1 ? "documento conferido" : "documentos conferidos"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <span>Gasto comprovado</span>
              <span className="font-mono font-semibold">{brl(alvo.gasto)}</span>
            </div>
            {temSaldo ? (
              <div className="flex justify-between rounded-md bg-teal-50 px-2 py-1.5 font-semibold text-teal-800">
                <span>Estorno do saldo</span>
                <span className="font-mono">−{brl(alvo.saldo)}</span>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Sem saldo: a verba foi toda comprovada.
              </p>
            )}
          </div>

          {temSaldo && (
            <div className="space-y-2">
              <p className="text-sm font-bold">
                Data prevista da devolução <span className="text-california-red">*</span>
              </p>
              <DatePicker
                id="aprovar-prestacao-data-prevista"
                name="aprovar_prestacao_data_prevista"
                onDateChange={(d) => {
                  setDataPrevista(
                    d
                      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                      : "",
                  );
                  setErro(null);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Quando o dinheiro deve voltar à conta. Vira a data do estorno de verba em Títulos a Pagar.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12px]">
            <span className="text-muted-foreground">Centro de custo</span>
            <strong>{alvo.centroDeCusto}</strong>
          </div>
          <p className="text-[11px] text-muted-foreground">
            O mesmo da PP.
            {temSaldo
              ? ` O realizado do item deixa de contar os ${brl(alvo.saldo)} não gastos.`
              : ""}
          </p>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-[11px] text-muted-foreground">
              {temSaldo ? "Cria 1 estorno em Títulos a Pagar" : "Não cria título"}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={aprovar}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {pending ? "Aprovando…" : "Aprovar prestação"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
