"use client";

/**
 * "Alterações do Financeiro" — o histórico das edições do orçado feitas pelo
 * financeiro (decisão 115). É o card de Erratas (`ErratasCard`) com a mesma
 * leitura: uma linha por alteração (data e hora, motivo, quantos itens e
 * QUEM fez); aberta, mostra item a item o antes → depois e o efeito no
 * faturamento previsto e no valor do job.
 *
 * O que muda em relação às Erratas: não há coluna de Planejado (o
 * financeiro edita só o orçado), o cabeçalho mostra a soma das alterações
 * — o par "na abertura → atual" continua no card de Erratas, que é o do job
 * inteiro — e, embaixo de cada uma, o que aconteceu com o envio e a
 * previsão de recebimento.
 *
 * Só existe depois da primeira alteração (Tiago, 28/09/2026): sem nenhuma,
 * a aba Informações fica como era.
 *
 * Do protótipo aprovado em 28/09/2026 (artifact `Re8sXDJpj8gzEk1tnCrt48`).
 */

import * as React from "react";
import { ArrowRight, ChevronRight, Landmark, TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import {
  tipoCustoLabel,
  type JobAlteracaoFinanceiroComItens,
  type PrevisaoDaAlteracao,
} from "@/lib/types";

interface Props {
  alteracoes: JobAlteracaoFinanceiroComItens[];
  moeda: string;
}

function formatarData(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Hora de Brasília: várias alterações podem cair no mesmo dia. */
function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function dataDoTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (Math.round(v * 100) === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

const pill = (positivo: boolean) =>
  positivo
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-red-200 bg-red-50 text-red-700";

/** Uma previsão que acompanhou a alteração: só as parcelas que mudaram.
 *  Nada quando nenhuma mudou — a alteração de uma linha FI, por exemplo,
 *  não mexe no faturamento. */
function PrevisaoQueAcompanhou({
  rotulo,
  antes,
  depois,
  moeda,
}: {
  rotulo: string;
  antes: PrevisaoDaAlteracao[];
  depois: PrevisaoDaAlteracao[];
  moeda: string;
}) {
  const mudaram = antes
    .map((p, k) => ({ p, k, novo: depois[k]?.valor ?? p.valor }))
    .filter(({ p, novo }) => Math.round(novo * 100) !== Math.round(p.valor * 100));
  if (mudaram.length === 0) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-[11.5px] text-muted-foreground">
      <span className="font-semibold text-foreground">{rotulo}</span>
      {mudaram.map(({ p, k, novo }) => (
        <span key={p.data_prevista + k} className="font-mono">
          {formatarData(p.data_prevista)} · {formatCurrency(p.valor, moeda)} →{" "}
          <span className="text-foreground">{formatCurrency(novo, moeda)}</span>
        </span>
      ))}
    </p>
  );
}

export function AlteracoesFinanceiroCard({ alteracoes, moeda }: Props) {
  // A mais recente aberta, como no card de Erratas.
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    if (alteracoes.length > 0) setAbertas({ [alteracoes[0].id]: true });
  }, [alteracoes]);

  if (alteracoes.length === 0) return null;

  const centavos = (n: number) => Math.round(n * 100);
  const somaJob =
    alteracoes.reduce((s, a) => s + centavos(a.valor_job_depois) - centavos(a.valor_job_antes), 0) / 100;
  const somaFat =
    alteracoes.reduce(
      (s, a) => s + centavos(a.faturamento_previsto_depois) - centavos(a.faturamento_previsto_antes),
      0,
    ) / 100;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft md:col-span-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-6 py-5">
        <Landmark className="h-4 w-4 text-california-red" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Alterações do Financeiro</h2>
        <span className="text-[11.5px] text-muted-foreground">
          Edições do orçado feitas pelo financeiro, sem aprovação, desde a abertura do job
        </span>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {alteracoes.length === 1 ? "1 alteração" : `Soma das ${alteracoes.length} alterações`}
            </p>
            <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
              fat. {comSinal(somaFat, moeda)}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-xs font-bold",
              pill(somaJob >= 0),
            )}
          >
            {somaJob >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {comSinal(somaJob, moeda)}
          </span>
        </div>
      </div>

      {alteracoes.map((a) => {
        const aberta = !!abertas[a.id];
        const deltaJob = (centavos(a.valor_job_depois) - centavos(a.valor_job_antes)) / 100;
        const deltaFat =
          (centavos(a.faturamento_previsto_depois) - centavos(a.faturamento_previsto_antes)) / 100;
        const deltaCusto = (centavos(a.custo_orcado_depois) - centavos(a.custo_orcado_antes)) / 100;
        return (
          <div key={a.id} className="border-b border-border/60 last:border-0">
            <button
              type="button"
              onClick={() => setAbertas((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
              className="grid w-full grid-cols-[96px_1fr_auto_auto_20px] items-center gap-4 px-6 py-3.5 text-left transition-colors hover:bg-california-red/[0.025]"
            >
              <span className="flex flex-col font-mono text-[11.5px] text-muted-foreground">
                {dataDoTimestamp(a.created_at)}
                <span className="text-[10.5px]">{formatarHora(a.created_at)}</span>
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold leading-tight">{a.motivo}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {a.itens.length} {a.itens.length === 1 ? "item" : "itens"}
                  {a.autor_nome ? ` · ${a.autor_nome}` : ""}
                </span>
              </div>
              <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
                Orçado {comSinal(deltaCusto, moeda)}
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">
                  fat. {comSinal(deltaFat, moeda)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-bold",
                    pill(deltaJob >= 0),
                  )}
                >
                  {comSinal(deltaJob, moeda)}
                </span>
              </span>
              <ChevronRight
                className={cn("h-4 w-4 text-[#c9c9c9] transition-transform", aberta && "rotate-90")}
              />
            </button>

            {aberta && (
              <div className="border-t border-border bg-muted/30 px-6 pb-4 pt-1.5">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                      <tr className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="w-[104px] py-2.5 pr-2 text-left">Alteração</th>
                        <th className="px-2 py-2.5 text-left">Item orçado</th>
                        <th className="w-[190px] px-2 py-2.5 text-left">Tipo de custo</th>
                        <th className="w-[260px] px-2 py-2.5 text-right">Valor orçado</th>
                        <th className="w-[150px] px-2 py-2.5 text-right">Efeito no fat. previsto</th>
                        <th className="w-[150px] py-2.5 pl-2 text-right">Efeito no valor do job</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.itens.map((i) => {
                        const qtdMudou =
                          i.quantidade_de !== i.quantidade_para || i.dias_meses_de !== i.dias_meses_para;
                        return (
                          <tr key={i.id} className="border-t border-border">
                            <td className="py-2.5 pr-2 align-top">
                              <span className="inline-flex items-center whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                                Valor
                              </span>
                            </td>
                            <td className="px-2 py-2.5 align-top">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[12.5px] font-medium leading-tight">{i.item_nome}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {i.grupo_nome}
                                  {i.mes ? ` · ${nomeDoMes(i.mes)}` : ""}
                                </span>
                              </div>
                            </td>
                            <td className="px-2 py-2.5 align-top">
                              <span className="inline-flex items-center rounded-full border border-border bg-white px-2 py-0.5 text-[10.5px] text-muted-foreground">
                                {tipoCustoLabel(i.tipo_custo)}
                              </span>
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
                              {qtdMudou && (
                                <p className="mt-0.5 whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">
                                  QT {i.quantidade_de.toLocaleString("pt-BR")} → {i.quantidade_para.toLocaleString("pt-BR")} · D/M{" "}
                                  {i.dias_meses_de.toLocaleString("pt-BR")} → {i.dias_meses_para.toLocaleString("pt-BR")}
                                </p>
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-right align-top">
                              <span
                                className={cn(
                                  "whitespace-nowrap font-mono text-xs",
                                  i.efeito_faturamento_previsto >= 0 ? "text-emerald-700" : "text-red-700",
                                )}
                              >
                                {comSinal(i.efeito_faturamento_previsto, moeda)}
                              </span>
                            </td>
                            <td className="py-2.5 pl-2 text-right align-top">
                              <span
                                className={cn(
                                  "whitespace-nowrap font-mono text-xs font-semibold",
                                  i.efeito_valor_job >= 0 ? "text-emerald-700" : "text-red-700",
                                )}
                              >
                                {comSinal(i.efeito_valor_job, moeda)}
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
                          Total desta alteração
                        </td>
                        <td className="whitespace-nowrap px-2 pt-3 text-right font-mono text-xs text-muted-foreground">
                          Orçado {comSinal(deltaCusto, moeda)}
                        </td>
                        <td className="whitespace-nowrap px-2 pt-3 text-right font-mono text-xs text-muted-foreground">
                          {comSinal(deltaFat, moeda)}
                        </td>
                        <td className="pl-2 pt-3 text-right">
                          <span
                            className={cn(
                              "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-bold",
                              pill(deltaJob >= 0),
                            )}
                          >
                            {comSinal(deltaJob, moeda)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {a.envio_antes.length > 0 && (
                  <p className="mt-3 flex flex-wrap items-baseline gap-x-3 text-[11.5px] text-muted-foreground">
                    <span className="font-semibold text-foreground">Envio para faturamento:</span>
                    {a.envio_antes.flatMap((e, k) =>
                      e.parcelas.map((p, j) => (
                        <span key={`${k}-${j}`} className="font-mono">
                          {e.mes ? `${nomeDoMes(e.mes)} · ` : ""}
                          {formatarData(p.data_vencimento)} · {formatCurrency(p.valor, moeda)} →{" "}
                          <span className="text-foreground">
                            {formatCurrency(a.envio_depois[k]?.parcelas[j]?.valor ?? p.valor, moeda)}
                          </span>
                        </span>
                      )),
                    )}
                  </p>
                )}
                <PrevisaoQueAcompanhou
                  rotulo="Previsão de recebimento:"
                  antes={a.recebimento_antes}
                  depois={a.recebimento_depois}
                  moeda={moeda}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
