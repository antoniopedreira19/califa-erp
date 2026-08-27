"use client";

/**
 * A barra da errata — o rodapé fixo que aparece com o modo ligado.
 *
 * Ela existe porque a edição agora acontece na planilha inteira, que é
 * alta: quem está corrigindo a última linha de um job de 40 itens não vê
 * o topo da tela. Os dois números que a errata move — faturamento previsto
 * e valor do job — precisam estar sempre à vista, junto do botão que grava.
 *
 * Do design `Planilha Interna - Alterar Orcado (Errata).dc.html` (projeto
 * Claude Design `69342d83`), 27/08/2026.
 */

import * as React from "react";
import { FilePenLine, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

interface ParDeValores {
  antes: number;
  depois: number;
}

interface Props {
  resumo: string;
  temMudanca: boolean;
  faturamento: ParDeValores;
  valorJob: ParDeValores;
  moeda: string;
  onDescartar: () => void;
  onConfirmar: () => void;
}

/** Custo que sobe é laranja, custo que desce é verde — a mesma leitura do
 *  resto do produto. Zero fica neutro. */
function corDoDelta(delta: number): string {
  if (delta > 0) return "text-[#c2410c]";
  if (delta < 0) return "text-[#047857]";
  return "text-muted-foreground";
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (v === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

function Par({
  rotulo,
  par,
  moeda,
}: {
  rotulo: string;
  par: ParDeValores;
  moeda: string;
}) {
  const delta = par.depois - par.antes;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(par.antes, moeda)}
        </span>
        <span className="font-mono text-[13px] font-bold text-foreground">
          {formatCurrency(par.depois, moeda)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {comSinal(delta, moeda)}
        </span>
      </div>
    </div>
  );
}

export function ErrataBarra({
  resumo,
  temMudanca,
  faturamento,
  valorJob,
  moeda,
  onDescartar,
  onConfirmar,
}: Props) {
  return (
    // `sticky` e não `fixed`: a barra pertence à planilha, e a sidebar do
    // app não pode ficar por baixo dela. Fica colada no pé da janela
    // enquanto a planilha rola, e some junto com ela.
    <div className="sticky bottom-0 z-30 -mx-1 mt-2 rounded-2xl border border-california-red/30 bg-card/95 px-4 py-3 shadow-elevated backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg bg-california-red/10 p-1.5">
            <FilePenLine className="h-4 w-4 text-california-red" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              Errata em edição · {resumo}
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Confirmar registra a errata, atualiza o faturamento previsto e
              devolve o job ao mural de abertura.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <Par rotulo="Faturamento previsto" par={faturamento} moeda={moeda} />
          <Par rotulo="Valor do job" par={valorJob} moeda={moeda} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDescartar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Descartar
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={!temMudanca}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FilePenLine className="h-3.5 w-3.5" />
              Confirmar errata
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
