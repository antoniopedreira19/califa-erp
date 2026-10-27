"use client";

/**
 * O rastro do cancelamento do job na página do orçamento (decisão 169): a
 * faixa no mesmo lugar e no mesmo desenho das faixas de estado da versão
 * (`BannersEstado`: "Abertura devolvida…", "Em correção…"). Diz quem pediu,
 * por quê, o que o financeiro observou, o histórico do pedido e o que saiu
 * das contas. As decisões do financeiro saem sem o nome de quem decidiu,
 * como a devolução da abertura (decisão 136) — o nome fica na auditoria.
 */

import * as React from "react";
import { Ban, ChevronDown } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { formatDataEHoraBr } from "@/lib/formatar-data-hora";
import type { RastroDoCancelamento } from "@/lib/data/cancelamentos";

function soData(iso: string): string {
  return formatDataEHoraBr(iso).slice(0, 10);
}

export function FaixaJobCancelado({ rastro }: { rastro: RastroDoCancelamento }) {
  const [historico, setHistorico] = React.useState(true);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-soft">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
          <Ban className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-slate-800">
            Job cancelado · <span className="font-mono">{rastro.jobCodigo}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            {rastro.motivo
              ? `Cancelado depois da abertura, a pedido da produção${
                  rastro.canceladoEm ? `, em ${soData(rastro.canceladoEm)}` : ""
                }.`
              : "Cancelado depois da abertura."}{" "}
            O orçamento fica como histórico: não se aprova de novo nem volta para abertura.
          </p>

          {rastro.motivo && (
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Motivo da produção
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{rastro.motivo}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Observação do financeiro
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {rastro.observacao?.trim() || (
                    <span className="text-muted-foreground">— sem observação</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {rastro.eventos.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setHistorico((v) => !v)}
                aria-expanded={historico}
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-600 hover:text-foreground"
              >
                Histórico
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", historico && "rotate-180")}
                />
              </button>
              {historico && (
                <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full table-fixed text-[13px]">
                    <colgroup>
                      <col className="w-[150px]" />
                      <col />
                      <col className="w-[200px]" />
                    </colgroup>
                    <tbody>
                      {rastro.eventos.map((ev, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-3.5 py-2 font-mono text-xs text-muted-foreground">
                            {formatDataEHoraBr(ev.em)}
                          </td>
                          <td className="px-3.5 py-2 text-foreground">{ev.texto}</td>
                          <td className="px-3.5 py-2 text-muted-foreground">{ev.por ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rastro.saida && (
                    <p className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-2 text-xs text-muted-foreground">
                      Saíram do fluxo de caixa: recebimento de{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {formatCurrency(rastro.saida.recebimento)}
                      </span>
                      , custo de{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {formatCurrency(rastro.saida.custo)}
                      </span>{" "}
                      e impostos de{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {formatCurrency(rastro.saida.impostos)}
                      </span>
                      .
                      {rastro.saida.projetoFinanceiroInativado && (
                        <>
                          {" "}
                          O projeto financeiro{" "}
                          <span className="font-medium text-foreground">{rastro.saida.projetoFinanceiroInativado}</span>{" "}
                          ficou inativo.
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
