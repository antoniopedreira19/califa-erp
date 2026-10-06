/**
 * O orçamento de Mídia Off na visão agregada (decisão 147, entrega 1): só
 * consulta, com o atalho para a tela do orçamento. A planilha dela é por
 * meio e mês, com a conta da mídia, e só se edita lá — o editor daqui é o
 * da planilha nacional.
 */

import type * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/** O que o card mostra, já calculado no servidor pela conta da mídia. */
export interface OrcamentoMidiaNaAgregada {
  id: string;
  nome: string;
  /** "v2 · aprovada", por exemplo. */
  detalhe: string;
  href: string;
  qtdMeses: number;
  qtdMeios: number;
  qtdLinhas: number;
  valorJob: number;
  faturamentoPrevisto: number;
  /** Os impostos (de dentro dos honorários) e as notas dos veículos — o
   *  que o resultado do projeto desconta. */
  imposto: number;
  custoPlanejado: number;
  resultadoGeral: number | null;
}

export function CardMidiaNaAgregada({
  orc,
  onAbrir,
}: {
  orc: OrcamentoMidiaNaAgregada;
  /** Com alteração por salvar, o atalho passa pela pergunta do Cancelar. */
  onAbrir?: (evento: React.MouseEvent, href: string) => void;
}) {
  const metrica = "whitespace-nowrap font-mono text-[13px] font-bold leading-4 text-foreground";
  const rotulo = "whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="text-[15px] font-bold tracking-[-0.01em]">{orc.nome}</span>
            <span className="rounded-md border border-border bg-muted/50 px-1.5 py-px font-mono text-[10.5px] font-semibold text-foreground/80">
              {orc.detalhe}
            </span>
            <span className="text-xs text-muted-foreground">
              Mídia Off · {orc.qtdMeses} {orc.qtdMeses === 1 ? "mês" : "meses"} · {orc.qtdMeios}{" "}
              {orc.qtdMeios === 1 ? "meio" : "meios"} · {orc.qtdLinhas} {orc.qtdLinhas === 1 ? "linha" : "linhas"}
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3 flex-none" />
            A planilha de Mídia Off é por meio e mês e se edita na tela do orçamento. Ela fica fora do quadro de
            Totais abaixo.
          </span>
        </div>
        <div className="grid flex-none grid-cols-[140px_140px_72px] gap-6">
          <div className="flex flex-col items-end gap-0.5">
            <span className={rotulo}>Faturamento</span>
            <span className={metrica}>{formatCurrency(orc.faturamentoPrevisto, "BRL")}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className={rotulo}>Valor do Job</span>
            <span className={metrica}>{formatCurrency(orc.valorJob, "BRL")}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className={rotulo}>Geral</span>
            <span className={metrica}>
              {orc.resultadoGeral === null ? "—" : `${orc.resultadoGeral.toFixed(1).replace(".", ",")}%`}
            </span>
          </div>
        </div>
        <Link
          href={orc.href}
          prefetch={false}
          onClick={(e) => onAbrir?.(e, orc.href)}
          className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
        >
          Editar na tela do orçamento
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
