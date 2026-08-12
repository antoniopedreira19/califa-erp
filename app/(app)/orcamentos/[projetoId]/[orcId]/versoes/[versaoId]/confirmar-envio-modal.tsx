"use client";

import * as React from "react";
import { Check, Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { OBSERVACOES_MAX } from "@/lib/validations/abertura-job";

/**
 * Confirmação do envio do job. Não usa o `ConfirmDialog` genérico: o
 * handoff pede ícone próprio, botão de confirmar em vermelho com check e
 * um card de resumo — combinação que o componente compartilhado não faz
 * sem virar um canivete de props.
 */
export function ConfirmarEnvioModal({
  open,
  onOpenChange,
  onConfirmar,
  onVoltar,
  pending,
  orcamentoCodigo,
  linhas,
  valorTotal,
  faturamentoPrevisto,
  moeda,
  observacoes,
  erro,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmar: () => void;
  onVoltar: () => void;
  pending: boolean;
  orcamentoCodigo: string;
  linhas: { rotulo: string; valor: string; mono?: boolean }[];
  /** Valor do Job — o que vai para `jobs.valor_total`. */
  valorTotal: number;
  /** O que a California emite nota nesta versão. */
  faturamentoPrevisto: number;
  moeda: string;
  /** Só leitura: este pop-up é conferência. Alterar exige voltar ao formulário. */
  observacoes: string;
  erro: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <Send className="h-[21px] w-[21px]" />
          </div>
          <DialogTitle className="pt-4 text-xl leading-snug">
            Tem certeza que quer enviar esse job para a abertura?
          </DialogTitle>
          <DialogDescription className="pt-1 leading-relaxed">
            O job será criado e enviado ao financeiro. Nome e datas alterados aqui
            serão gravados no orçamento{" "}
            <strong className="font-semibold text-foreground">
              {orcamentoCodigo}
            </strong>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3.5">
          {linhas.map((l) => (
            <div
              key={l.rotulo}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="shrink-0 text-[13px] text-muted-foreground">
                {l.rotulo}
              </span>
              <span
                className={cn(
                  "text-right text-[13px] font-semibold text-foreground",
                  l.mono && "font-mono",
                )}
              >
                {l.valor}
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-[13px] font-semibold">
              Faturamento previsto
            </span>
            <span className="font-mono text-[15px] font-bold text-california-red">
              {formatCurrency(faturamentoPrevisto, moeda)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold">Valor total</span>
            <span className="font-mono text-[15px] font-bold text-foreground">
              {formatCurrency(valorTotal, moeda)}
            </span>
          </div>
        </div>

        {/* Observações aparecem aqui só para conferência. Mesma caixa do
            handoff, mas travada: este pop-up não edita nada. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <span className="text-[12.5px] font-semibold">Observações</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {observacoes.length}/{OBSERVACOES_MAX}
            </span>
          </div>
          <div
            data-testid="obs-confirmacao"
            className={cn(
              "min-h-[76px] max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-[13px] leading-relaxed",
              observacoes ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {observacoes || "—"}
          </div>
          <span className="text-[11px] text-muted-foreground">
            Para alterar, use &quot;Voltar e revisar&quot;.
          </span>
        </div>

        {erro && (
          <p className="text-xs text-california-red">{erro}</p>
        )}

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onVoltar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            Voltar e revisar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Sim, enviar job
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
