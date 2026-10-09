"use client";

/**
 * A faixa da errata PRONTA PARA ENVIO (decisão 159).
 *
 * O produtor corrige a planilha e deixa a errata pronta; quem envia ao
 * financeiro é um GP (ou administrador). Entre uma coisa e outra a errata
 * existe, mas não pesa em nada: o orçado do job, o faturamento previsto e o
 * mural do financeiro seguem como estavam. Esta faixa é o que diz isso na
 * tela — e é por ela que o GP chega à errata para revisar e enviar.
 *
 * Fica no topo da Planilha Interna, acima da barra de ferramentas: é o
 * lugar em que a errata é feita, e quem abre o job para mexer nela passa
 * por ali.
 */

import * as React from "react";
import { FilePenLine, PencilLine, Trash2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { ErrataPronta } from "@/lib/types";

/** "08/10/2026 às 14:20", no horário de Brasília. */
export function quandoDaPronta(iso: string): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} às ${hora}`;
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

interface Props {
  pronta: ErrataPronta;
  /** Quem está vendo: o GP registra (envia), o produtor prepara. */
  modo: "registra" | "prepara";
  moeda: string;
  /** Abre a errata pronta na planilha, no modo errata. */
  onAbrir: () => void;
  onDescartar: () => void;
  /** A errata não pode abrir agora (job enviado para faturamento…). O
   *  motivo vai no `title` do botão. */
  travadoPor: string | null;
}

export function ErrataProntaFaixa({
  pronta,
  modo,
  moeda,
  onAbrir,
  onDescartar,
  travadoPor,
}: Props) {
  const envia = modo === "registra";
  const centavos = (n: number) => Math.round(n * 100);
  const delta =
    (centavos(pronta.valorJob.depois) - centavos(pronta.valorJob.antes)) / 100;
  const quando = quandoDaPronta(pronta.preparadaEm);

  return (
    <div
      className="rounded-2xl border border-california-red/30 bg-card px-4 py-3 shadow-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg bg-california-red/10 p-1.5">
            <FilePenLine className="h-4 w-4 text-california-red" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-[13px] font-semibold text-foreground">
              Errata pronta para envio · {pronta.resumo}
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Preparada por{" "}
              <strong className="font-semibold text-foreground">
                {pronta.preparadaPorNome}
              </strong>{" "}
              em {quando}.{" "}
              {envia
                ? "Revise na planilha e confirme para enviar ao financeiro — até lá, nada muda no job."
                : "Aguardando um GP revisar e enviar ao financeiro — até lá, nada muda no job."}
            </p>
            {pronta.descricao ? (
              <p className="border-l-2 border-california-red/30 pl-2.5 text-[12px] leading-relaxed text-foreground">
                {pronta.descricao}
              </p>
            ) : (
              <p className="text-[11.5px] italic text-muted-foreground">
                Sem descrição: o GP escreve no envio.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Valor do job
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11.5px] text-muted-foreground line-through">
                {formatCurrency(pronta.valorJob.antes, moeda)}
              </span>
              <span className="font-mono text-[13px] font-bold text-foreground">
                {formatCurrency(pronta.valorJob.depois, moeda)}
              </span>
              <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
                {comSinal(delta, moeda)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDescartar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Descartar
            </button>
            <button
              type="button"
              onClick={onAbrir}
              disabled={travadoPor !== null}
              title={travadoPor ?? undefined}
              className={cn(
                envia
                  ? "inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover"
                  : "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06]",
                "disabled:cursor-not-allowed disabled:opacity-45",
              )}
            >
              {envia ? (
                <FilePenLine className="h-3.5 w-3.5" />
              ) : (
                <PencilLine className="h-3.5 w-3.5 text-california-red" />
              )}
              {envia ? "Revisar e enviar" : "Editar errata"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
