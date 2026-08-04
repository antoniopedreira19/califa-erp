"use client";

import * as React from "react";
import { History, ArrowRight, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { tipoCustoLabel, type JobErrataComItens, type JobErrataItem } from "@/lib/types";

interface Props {
  erratas: JobErrataComItens[];
  faturamentoAbertura: number | null;
  faturamentoAtual: number;
  moeda: string;
}

function formatarData(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (v === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

/** Classifica a mudança do item pro rótulo colorido, como no design. */
function tagDaMudanca(i: JobErrataItem): { rotulo: string; classe: string } {
  const mudouTipo = i.tipo_custo_de !== i.tipo_custo_para;
  const mudouValor = i.valor_unitario_de !== i.valor_unitario_para;
  if (mudouTipo && !mudouValor) {
    return {
      rotulo: "Tipo de custo",
      classe: "border-[#ddd6c9] bg-[#f1f0ec] text-foreground",
    };
  }
  return {
    rotulo: "Valor",
    classe: "border-blue-200 bg-blue-50 text-blue-700",
  };
}

export function ErratasCard({
  erratas,
  faturamentoAbertura,
  faturamentoAtual,
  moeda,
}: Props) {
  // Primeira aberta, como no design.
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (erratas.length > 0) setAbertas({ [erratas[0].id]: true });
  }, [erratas]);

  const base = faturamentoAbertura ?? faturamentoAtual;
  const delta = faturamentoAtual - base;
  const vazio = erratas.length === 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft md:col-span-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-6 py-5">
        <History className="h-4 w-4 text-california-red" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          Erratas
        </h2>
        <span className="text-[11.5px] text-muted-foreground">
          Alterações de itens orçados e tipos de custo após a abertura do job
        </span>

        {/* Sem errata não há "antes x depois" que faça sentido: mostra só o
            faturamento atual, e o card fica visível pra funcionalidade não
            parecer inexistente. */}
        <div className="ml-auto flex items-center gap-4">
          {!vazio && (
            <>
              <div className="text-right">
                <p className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Faturamento na abertura
                </p>
                <p className="mt-0.5 font-mono text-[13px] text-muted-foreground">
                  {formatCurrency(base, moeda)}
                </p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-[#c9c9c9]" />
            </>
          )}
          <div className="text-right">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {vazio ? "Faturamento" : "Faturamento atual"}
            </p>
            <p className="mt-0.5 font-mono text-[13px] font-bold">
              {formatCurrency(faturamentoAtual, moeda)}
            </p>
          </div>
          {!vazio && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-xs font-bold",
                delta >= 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700",
              )}
            >
              {delta >= 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {comSinal(delta, moeda)}
            </span>
          )}
        </div>
      </div>

      {vazio && (
        <p className="px-6 py-5 text-sm text-muted-foreground">
          Nenhuma errata registrada. Alterações no orçado do job são feitas pelo
          botão <strong className="text-foreground">Alterar orçado</strong>, na
          aba Planilha Interna, e aparecem aqui.
        </p>
      )}

      {erratas.map((e) => {
        const aberta = !!abertas[e.id];
        const deltaErrata = e.faturamento_depois - e.faturamento_antes;
        const deltaCusto = e.custo_orcado_depois - e.custo_orcado_antes;

        return (
          <div key={e.id} className="border-b border-border/60 last:border-0">
            <button
              type="button"
              onClick={() =>
                setAbertas((prev) => ({ ...prev, [e.id]: !prev[e.id] }))
              }
              className="grid w-full grid-cols-[96px_1fr_auto_auto_20px] items-center gap-4 px-6 py-3.5 text-left transition-colors hover:bg-california-red/[0.025]"
            >
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {formatarData(e.created_at)}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold leading-tight">
                  {e.titulo}
                </span>
                <span className="text-[11.5px] text-muted-foreground">
                  {e.itens.length}{" "}
                  {e.itens.length === 1 ? "item" : "itens"}
                  {e.autor_nome ? ` · ${e.autor_nome}` : ""}
                </span>
              </div>
              <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
                Orçado {comSinal(deltaCusto, moeda)}
              </span>
              <span
                className={cn(
                  "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-bold",
                  deltaErrata >= 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-red-200 bg-red-50 text-red-700",
                )}
              >
                {comSinal(deltaErrata, moeda)}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-[#c9c9c9] transition-transform",
                  aberta && "rotate-90",
                )}
              />
            </button>

            {aberta && (
              <div className="border-t border-border bg-muted/30 px-6 pb-4 pt-1.5">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse">
                    <thead>
                      <tr className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="w-[104px] py-2.5 pr-2 text-left">
                          Alteração
                        </th>
                        <th className="px-2 py-2.5 text-left">Item orçado</th>
                        <th className="w-[190px] px-2 py-2.5 text-left">
                          Tipo de custo
                        </th>
                        <th className="w-[200px] px-2 py-2.5 text-right">
                          Valor orçado
                        </th>
                        <th className="w-[140px] py-2.5 pl-2 text-right">
                          Efeito no faturamento
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.itens.map((i) => {
                        const tag = tagDaMudanca(i);
                        const tipoMudou = i.tipo_custo_de !== i.tipo_custo_para;
                        return (
                          <tr key={i.id} className="border-t border-border">
                            <td className="py-2.5 pr-2 align-top">
                              <span
                                className={cn(
                                  "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                                  tag.classe,
                                )}
                              >
                                {tag.rotulo}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 align-top">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[12.5px] font-medium leading-tight">
                                  {i.item_nome}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {i.grupo_nome}
                                </span>
                              </div>
                            </td>
                            <td className="px-2 py-2.5 align-top">
                              {tipoMudou ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center rounded-full border border-border bg-white px-2 py-0.5 text-[10.5px] text-muted-foreground line-through">
                                    {tipoCustoLabel(i.tipo_custo_de)}
                                  </span>
                                  <ArrowRight className="h-3 w-3 text-[#c9c9c9]" />
                                  <span className="inline-flex items-center rounded-full border border-[#ddd6c9] bg-[#f1f0ec] px-2 py-0.5 text-[10.5px] font-semibold">
                                    {tipoCustoLabel(i.tipo_custo_para)}
                                  </span>
                                </div>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-border bg-white px-2 py-0.5 text-[10.5px] text-muted-foreground">
                                  {tipoCustoLabel(i.tipo_custo_para)}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-right align-top">
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {i.total_de !== i.total_para && (
                                  <>
                                    <span className="whitespace-nowrap font-mono text-xs text-muted-foreground line-through">
                                      {formatCurrency(i.total_de, moeda)}
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-[#c9c9c9]" />
                                  </>
                                )}
                                <span className="whitespace-nowrap font-mono text-xs font-semibold">
                                  {formatCurrency(i.total_para, moeda)}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 pl-2 text-right align-top">
                              <span
                                className={cn(
                                  "whitespace-nowrap font-mono text-xs font-semibold",
                                  i.efeito_faturamento >= 0
                                    ? "text-emerald-700"
                                    : "text-red-700",
                                )}
                              >
                                {comSinal(i.efeito_faturamento, moeda)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-t-[#d7d7d7]">
                        <td
                          colSpan={3}
                          className="pr-2 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          Total desta errata
                        </td>
                        <td className="whitespace-nowrap px-2 pt-3 text-right font-mono text-xs text-muted-foreground">
                          Orçado {comSinal(deltaCusto, moeda)}
                        </td>
                        <td className="pl-2 pt-3 text-right">
                          <span
                            className={cn(
                              "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-bold",
                              deltaErrata >= 0
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700",
                            )}
                          >
                            {comSinal(deltaErrata, moeda)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {e.justificativa && (
                  <p className="mt-3.5 text-[11.5px] text-muted-foreground">
                    {e.justificativa}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
