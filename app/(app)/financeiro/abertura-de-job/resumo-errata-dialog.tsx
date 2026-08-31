"use client";

/**
 * O resumo da errata, no mural de abertura.
 *
 * É só o essencial para o financeiro decidir se entra na revisão agora — o
 * detalhe linha a linha fica na planilha do job. A conferência de valores
 * continua acontecendo na tela de abertura de sempre, que agora chega
 * pré-carregada com os números da errata.
 *
 * Do design `Planilha Interna - Alterar Orcado (Errata).dc.html` (projeto
 * Claude Design `69342d83`), 27/08/2026.
 */

import * as React from "react";
import Link from "next/link";
import { FilePenLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import type { FilaLinha } from "./fila-list";

function dataHora(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function corDoDelta(delta: number): string {
  if (delta > 0) return "text-[#c2410c]";
  if (delta < 0) return "text-[#047857]";
  return "text-muted-foreground";
}

function Par({
  rotulo,
  antes,
  depois,
}: {
  rotulo: string;
  antes: number | null;
  depois: number | null;
}) {
  if (antes === null || depois === null) {
    return (
      <div className="flex items-center justify-between gap-4 py-1.5">
        <span className="text-[12.5px] text-muted-foreground">{rotulo}</span>
        <span className="text-[12.5px] text-muted-foreground">
          não registrado
        </span>
      </div>
    );
  }
  const delta = depois - antes;
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-[12.5px] text-muted-foreground">{rotulo}</span>
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(antes)}
        </span>
        <span className="font-mono text-[13px] font-bold text-foreground">
          {formatCurrency(depois)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {delta === 0
            ? formatCurrency(0)
            : `${delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(delta))}`}
        </span>
      </div>
    </div>
  );
}

export function ResumoErrataDialog({
  job,
  onOpenChange,
}: {
  job: FilaLinha | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const r = job?.revisao ?? null;

  return (
    <Dialog open={job !== null && r !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[520px] overflow-y-auto">
        {job && r && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
                  <FilePenLine className="h-4.5 w-4.5 text-california-red" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[19px]">
                    Resumo da errata
                  </DialogTitle>
                  <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                    <span className="font-mono font-semibold text-[#b3323c]">
                      {job.codigo}
                    </span>{" "}
                    {job.nome} · {r.autorNome ?? "—"} · {dataHora(r.em)}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-1">
              <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Descrição
                </p>
                <p className="mt-1 text-[12.5px] italic leading-relaxed text-foreground">
                  “{r.descricao}”
                </p>
              </div>

              <div className="rounded-xl border border-border px-3.5 py-2">
                <Par
                  rotulo="Faturamento previsto"
                  antes={r.faturamentoAntes}
                  depois={r.faturamentoDepois}
                />
                <Par
                  rotulo="Valor do job · orçado"
                  antes={r.valorJobAntes}
                  depois={r.valorJobDepois}
                />
                <div className="flex items-center justify-between gap-4 py-1.5">
                  <span className="text-[12.5px] text-muted-foreground">
                    Linhas afetadas
                  </span>
                  <span className="text-[12.5px] font-semibold text-foreground">
                    {r.linhasAlteradas} alterada
                    {r.linhasAlteradas === 1 ? "" : "s"} · {r.linhasNovas} nova
                    {r.linhasNovas === 1 ? "" : "s"} · {r.linhasRemovidas}{" "}
                    removida{r.linhasRemovidas === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Na tela de abertura você reconfere{" "}
                <strong className="font-semibold text-foreground">
                  previsão de recebimento
                </strong>
                ,{" "}
                <strong className="font-semibold text-foreground">
                  curva de desembolso
                </strong>{" "}
                e{" "}
                <strong className="font-semibold text-foreground">
                  competência
                </strong>
                . O job segue aberto; o faturamento fica bloqueado até a revisão
                ser salva.
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex items-center rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                >
                  Fechar
                </button>
                {/* O registro da abertura de um job JÁ ABERTO mora em
                    `/financeiro/jobs/[jobId]` — é lá que
                    `editarRegistroDaAbertura` roda e apaga
                    `abertura_em_revisao`. `/financeiro/abertura-de-job/
                    [jobId]` só atende quem ainda está
                    `aguardando_abertura` e redireciona todo o resto para
                    a página do job: o botão devolvia o financeiro para
                    uma tela de leitura e a revisão não tinha como ser
                    encerrada — o job ficava preso fora do faturamento
                    para sempre (31/08/2026). */}
                <Link
                  href={`/financeiro/jobs/${job.id}`}
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover"
                >
                  <FilePenLine className="h-3.5 w-3.5" />
                  Prosseguir para abertura
                </Link>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
