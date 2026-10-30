"use client";

/**
 * A barra do "Editar planilha" do financeiro (decisão 115) — o rodapé que
 * aparece com o modo ligado. Mesma barra da errata (`ErrataBarra`), com o
 * texto do que a confirmação FAZ aqui. Na fila da abertura, grava na hora
 * e o formulário da abertura acompanha; com o job aberto (opção C,
 * 30/10/2026), não grava: "Continuar para a abertura" leva o rascunho até a
 * aba Abertura do Job, que registra a alteração e a revisão juntas.
 */

import * as React from "react";
import { FilePenLine, X, Undo2 } from "lucide-react";
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
  onDesfazer: () => void;
  podeDesfazer: boolean;
  onConfirmar: () => void;
  /** Job ainda na fila da abertura: não há revisão a falar, e quem
   *  acompanha é o formulário da aba Abertura do Job. */
  naAbertura: boolean;
  /** Job aberto, nas abas do financeiro: o botão continua para a aba
   *  Abertura do Job em vez de gravar (opção C). */
  comRevisao: boolean;
  /** A conta do rascunho está indo ao servidor. */
  continuando: boolean;
  /** A revisão está no ar: o rodapé dela ocupa o pé da tela, e a barra
   *  sobe por cima dele. */
  acimaDoRodape: boolean;
  /** O que impediu de continuar para a abertura. */
  erro: string | null;
}

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

function Par({ rotulo, par, moeda }: { rotulo: string; par: ParDeValores; moeda: string }) {
  const centavos = (n: number) => Math.round(n * 100);
  const delta = (centavos(par.depois) - centavos(par.antes)) / 100;
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

export function EdicaoFinanceiroBarra({
  resumo,
  temMudanca,
  faturamento,
  valorJob,
  moeda,
  onDescartar,
  onConfirmar,
  onDesfazer,
  podeDesfazer,
  naAbertura,
  comRevisao,
  continuando,
  acimaDoRodape,
  erro,
}: Props) {
  return (
    <div
      className={cn(
        "sticky z-30 -mx-1 mt-2 rounded-2xl border border-california-red/30 bg-card/95 px-4 py-3 shadow-elevated backdrop-blur",
        acimaDoRodape ? "bottom-[80px]" : "bottom-0",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg bg-california-red/10 p-1.5">
            <FilePenLine className="h-4 w-4 text-california-red" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              Edição da planilha · {resumo}
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {comRevisao
                ? "Nada é gravado ainda: continue para a aba Abertura do Job, ajuste as previsões e registre a alteração e a revisão juntas."
                : naAbertura
                  ? "Confirmar grava a alteração na hora, sem aprovação, e a registra em Alterações do Financeiro com o seu nome. O formulário da abertura acompanha."
                  : "Confirmar grava a alteração na hora, sem aprovação e sem revisão da abertura, e a registra em Alterações do Financeiro com o seu nome."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <Par rotulo="Faturamento previsto" par={faturamento} moeda={moeda} />
          <Par rotulo="Valor do job" par={valorJob} moeda={moeda} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDesfazer}
              disabled={!podeDesfazer}
              title="Desfazer o último passo (Cmd+Z / Ctrl+Z)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Desfazer
            </button>
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
              disabled={!temMudanca || continuando}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FilePenLine className="h-3.5 w-3.5" />
              {comRevisao
                ? continuando
                  ? "Calculando…"
                  : "Continuar para a abertura"
                : "Confirmar alteração"}
            </button>
          </div>
        </div>
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-[12px] font-medium text-california-red">
          {erro}
        </p>
      )}
    </div>
  );
}
