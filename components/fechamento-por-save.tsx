"use client";

/**
 * A divisão do fechamento por FUNÇÃO do save, e o botão que a liga e
 * desliga.
 *
 * Fonte única das quatro telas que fecham orçado: versão do orçamento,
 * visão agregada de orçamentos, planilha interna do job e visão agregada
 * de jobs — as mesmas quatro que já dividem a `LegendaFechamento`. A
 * linha de três colunas estava copiada em duas delas, idêntica, e ia
 * virar quatro cópias quando as agregadas ganhassem a divisão
 * (01/09/2026). O texto da legenda já divergiu uma vez por esse caminho.
 *
 * As três colunas somam exatamente o subtotal do tipo, por construção:
 * save usado + save gerado + custos do job = total orçado
 * (`QuebraSave`, em lib/calculos/versao-totais.ts).
 */

import * as React from "react";
import { Columns3 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

/** Grade das três colunas — o cabeçalho e as linhas usam a MESMA, senão
 *  os rótulos não caem sobre os valores. */
const GRADE = "grid grid-cols-[1fr_repeat(3,minmax(84px,auto))] gap-x-3";

/**
 * O liga-desliga da divisão, ao lado do título do fechamento.
 *
 * Fechado é o padrão, como no design `Orcamento - Versao com Save.dc.html`
 * (projeto Claude Design `69342d83`): a divisão é leitura de conferência,
 * não o número do dia a dia.
 */
export function BotaoColunasSave({
  aberto,
  onAlternar,
}: {
  aberto: boolean;
  onAlternar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      title={
        aberto
          ? "Fechar as colunas de save"
          : "Abrir as colunas de save nos sub-totais"
      }
      aria-pressed={aberto}
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors",
        aberto
          ? "border-[#5f5d57] bg-[#f3f2ee] text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-[#5f5d57]",
      )}
    >
      <Columns3 className="h-3 w-3" />
      Save
    </button>
  );
}

/** Cabeçalho das três colunas. Só aparece com a divisão aberta. */
export function CabecalhoColunasSave() {
  return (
    <div
      className={cn(
        GRADE,
        "pb-1 text-right text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground",
      )}
    >
      <span />
      <span>Save usado</span>
      <span>Save gerado</span>
      <span>Custos do job</span>
    </div>
  );
}

/** Uma linha do fechamento repartida nas três naturezas. */
export function LinhaQuebradaPorSave({
  label,
  usado,
  gerado,
  custos,
  moeda,
  destaque,
}: {
  label: string;
  usado: number;
  gerado: number;
  custos: number;
  moeda: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        GRADE,
        "items-baseline",
        destaque && "mt-3 border-t border-border pt-3",
      )}
    >
      <span
        className={cn(
          "text-sm",
          destaque ? "font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {[usado, gerado, custos].map((v, i) => (
        <span
          key={i}
          className={cn(
            "whitespace-nowrap text-right font-mono text-[12.5px]",
            destaque ? "font-bold" : "font-semibold",
            v === 0 && "text-muted-foreground/50",
          )}
        >
          {formatCurrency(v, moeda)}
        </span>
      ))}
    </div>
  );
}
