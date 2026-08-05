"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import { jobStatusLabel, type JobStatus } from "@/lib/types";
import type { JobPlanilhaProjeto } from "./tipos";

const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";
const GRADE_ORCADO = "border-r border-r-[#eceae5]";
const GRADE_PLANEJADO = "border-r border-r-[#e6eff9]";
const GRADE_REALIZADO = "border-r border-r-[#fde8b8]";

const FUNDO_ORCADO = "bg-black/[0.015]";
const FUNDO_PLANEJADO = "bg-blue-50/40";
const FUNDO_REALIZADO = "bg-[#fef3c7]/40";

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "em_producao":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "encerrado":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelado":
      return "border-slate-200 bg-slate-100 text-slate-500";
    case "aguardando_abertura":
      return "border-yellow-200 bg-yellow-50 text-yellow-700";
    case "rejeitado_financeiro":
      return "border-red-200 bg-red-50 text-red-700";
  }
}

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/** Célula "R$ x,xx / y,y%" das linhas de Rentabilidade do rodapé. */
function CelulaRentabilidade({
  orcado,
  custo,
  moeda,
  corValor,
  corPercentual,
}: {
  orcado: number;
  custo: number;
  moeda: string;
  corValor: string;
  corPercentual: string;
}) {
  const { rentabilidade, percentual } = calcularRentabilidade(orcado, custo);

  if (custo <= 0) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn("font-mono text-[12.5px] font-bold", corValor)}>
        {formatCurrency(rentabilidade, moeda)}
      </span>
      {percentual !== null && (
        <span className={cn("font-mono text-[10.5px]", corPercentual)}>
          {formatarPercentual(percentual)}
        </span>
      )}
    </div>
  );
}

/** Valor monetário que vira travessão quando ninguém lançou nada. */
function moedaOuTraco(n: number, moeda: string): string {
  return n > 0 ? formatCurrency(n, moeda) : "—";
}

function numeroOuTraco(n: number): string {
  return n > 0 ? String(n) : "—";
}

export function PlanilhaJobCard({ job }: { job: JobPlanilhaProjeto }) {
  const [aberto, setAberto] = React.useState(false);
  const [gruposAbertos, setGruposAbertos] = React.useState<Set<string>>(
    new Set(),
  );

  const moeda = job.moeda;
  const totalItens = job.grupos.reduce((s, g) => s + g.itens.length, 0);

  function toggleGrupo(id: string) {
    setGruposAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setAberto((v) => !v);
          }
        }}
        className={cn(
          "flex cursor-pointer items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-[#f0eeee]/90 focus-visible:outline-none focus-visible:bg-[#f0eeee]/90",
          aberto ? "border-b border-border bg-muted/90" : "bg-muted/40",
        )}
      >
        <span
          className={cn(
            "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-transform duration-150",
            aberto && "rotate-90",
          )}
        >
          <ChevronRight className="h-[17px] w-[17px]" />
        </span>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xs font-bold text-[#b3323c]">
              {job.codigo}
            </span>
            <h3 className="text-[15px] font-semibold">{job.nome}</h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em]",
                statusBadgeClasses(job.status),
              )}
            >
              {jobStatusLabel(job.status)}
            </span>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            {job.responsavel ?? "Sem responsável"} · {job.grupos.length}{" "}
            {job.grupos.length === 1 ? "agrupamento" : "agrupamentos"} ·{" "}
            {totalItens} {totalItens === 1 ? "item" : "itens"}
          </p>
        </div>

        <div className="ml-auto flex items-stretch">
          <div className="border-l-2 border-l-[#d7d7d7] px-4 text-right">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              Orçado
            </p>
            <p className="mt-[3px] whitespace-nowrap font-mono text-[13px] font-bold">
              {formatCurrency(job.orcado, moeda)}
            </p>
          </div>
          <div className="border-l-2 border-l-[#b9d1f4] px-4 text-right">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-[#5a76a8]">
              Planejado
            </p>
            <p className="mt-[3px] whitespace-nowrap font-mono text-[13px] font-bold text-[#1e4fa3]">
              {moedaOuTraco(job.planejado, moeda)}
            </p>
          </div>
          <div className="border-l-2 border-l-[#f0c874] px-4 text-right">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-[#a3703a]">
              Realizado
            </p>
            <p className="mt-[3px] whitespace-nowrap font-mono text-[13px] font-bold text-[#92400e]">
              {moedaOuTraco(job.realizado, moeda)}
            </p>
          </div>
        </div>

        <Link
          href={`/jobs/${job.id}?from=jobs`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          className="ml-2 inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-california-red hover:text-california-red/80"
        >
          Abrir job
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {aberto && (
        <div className="overflow-x-auto">
          {/* Largura automática, como no design: o bloco de agrupamento tem
              210px de referência e os três blocos numéricos dividem o resto. */}
          <table className="w-full min-w-[1320px] border-collapse text-sm">
            <thead>
              <tr>
                <th colSpan={3} className="border-b border-border bg-muted/40" />
                <th
                  colSpan={4}
                  className="border-b-[3px] border-l-2 border-b-[#282828] border-l-[#d7d7d7] bg-[#f1f0ec] px-3 py-2 text-center text-[11px] font-extrabold tracking-[0.1em] text-foreground"
                >
                  ORÇADO
                </th>
                <th
                  colSpan={4}
                  className="border-b-[3px] border-l-2 border-b-[#2f6fdb] border-l-[#b9d1f4] bg-[#e8f0fd] px-3 py-2 text-center text-[11px] font-extrabold tracking-[0.1em] text-[#1e4fa3]"
                >
                  PLANEJADO
                </th>
                <th
                  colSpan={4}
                  className="border-b-[3px] border-l-2 border-b-[#d97706] border-l-[#f0c874] bg-[#fef3c7] px-3 py-2 text-center text-[11px] font-extrabold tracking-[0.1em] text-[#92400e]"
                >
                  REALIZADO
                </th>
              </tr>
              <tr className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="w-[210px] border-r border-r-border px-3 py-2 text-left">
                  Agrupamento · item
                </th>
                <th className="border-r border-r-border px-2 py-2 text-left">
                  Tipo
                </th>
                <th className="border-r border-r-border px-3 py-2 text-left">
                  Categoria
                </th>
                <th className="border-l-2 border-r border-l-[#e4e2dd] border-r-border px-3 py-2 text-right">
                  R$ Unit.
                </th>
                <th className="border-r border-r-border px-1.5 py-2 text-right">
                  QT
                </th>
                <th className="border-r border-r-border px-1.5 py-2 text-right">
                  D/M
                </th>
                <th className="min-w-[132px] px-3 py-2 text-right">Total</th>
                <th className="border-l-2 border-r border-l-[#cfe0f7] border-r-[#dfeafb] bg-blue-50/60 px-3 py-2 text-right text-[#5a76a8]">
                  R$ Unit.
                </th>
                <th className="border-r border-r-[#dfeafb] bg-blue-50/60 px-1.5 py-2 text-right text-[#5a76a8]">
                  QT
                </th>
                <th className="border-r border-r-[#dfeafb] bg-blue-50/60 px-1.5 py-2 text-right text-[#5a76a8]">
                  D/M
                </th>
                <th className="min-w-[132px] bg-blue-50/60 px-3 py-2 text-right text-[#5a76a8]">
                  Total
                </th>
                <th className="border-l-2 border-r border-l-[#f0c874] border-r-[#fde8b8] bg-[#fef3c7]/70 px-3 py-2 text-right text-[#92400e]">
                  R$ Unit.
                </th>
                <th className="border-r border-r-[#fde8b8] bg-[#fef3c7]/70 px-1.5 py-2 text-right text-[#92400e]">
                  QT
                </th>
                <th className="border-r border-r-[#fde8b8] bg-[#fef3c7]/70 px-1.5 py-2 text-right text-[#92400e]">
                  D/M
                </th>
                <th className="min-w-[132px] bg-[#fef3c7]/70 px-3 py-2 text-right text-[#92400e]">
                  Total
                </th>
              </tr>
            </thead>

            <tbody>
              {job.grupos.length === 0 && (
                <tr>
                  <td
                    colSpan={15}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    A versão aprovada deste job não tem agrupamentos.
                  </td>
                </tr>
              )}
              {job.grupos.map((g) => {
                const gAberto = gruposAbertos.has(g.id);
                return (
                  <React.Fragment key={g.id}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={gAberto}
                      onClick={() => toggleGrupo(g.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleGrupo(g.id);
                        }
                      }}
                      className={cn(
                        "cursor-pointer border-b border-border transition-colors hover:bg-[#f4f2f2]/90 focus-visible:outline-none focus-visible:bg-[#f4f2f2]/90",
                        gAberto && "bg-[#f8f7f7]/90",
                      )}
                    >
                      <td colSpan={3} className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex items-center justify-center text-[#8a8a8a] transition-transform duration-150",
                              gAberto && "rotate-90",
                            )}
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-[13px] font-semibold">
                            {g.nome}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {g.itens.length}{" "}
                            {g.itens.length === 1 ? "item" : "itens"}
                          </span>
                        </div>
                      </td>
                      <td
                        colSpan={3}
                        className={cn(
                          "border-l-2 border-l-[#e4e2dd]",
                          FUNDO_ORCADO,
                        )}
                      />
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold",
                          FUNDO_ORCADO,
                        )}
                      >
                        {formatCurrency(g.orcado, moeda)}
                      </td>
                      <td
                        colSpan={3}
                        className={cn(
                          "border-l-2 border-l-[#cfe0f7]",
                          FUNDO_PLANEJADO,
                        )}
                      />
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold text-[#1e4fa3]",
                          FUNDO_PLANEJADO,
                        )}
                      >
                        {moedaOuTraco(g.planejado, moeda)}
                      </td>
                      <td
                        colSpan={3}
                        className={cn(
                          "border-l-2 border-l-[#f0c874]",
                          FUNDO_REALIZADO,
                        )}
                      />
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold text-[#92400e]",
                          FUNDO_REALIZADO,
                        )}
                      >
                        {moedaOuTraco(g.realizado, moeda)}
                      </td>
                    </tr>

                    {gAberto &&
                      g.itens.map((it) => (
                        <tr key={it.id} className="border-b border-b-[#f4f2f2]">
                          <td
                            className={cn(
                              "py-2.5 pl-[34px] pr-3 text-xs",
                              GRADE_NEUTRA,
                            )}
                          >
                            <div className="truncate">{it.nome}</div>
                          </td>
                          <td className={cn("px-2 py-2.5", GRADE_NEUTRA)}>
                            <span className="inline-flex items-center rounded-full border border-border px-1.5 py-px text-[10px] font-semibold">
                              {it.tipo}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {it.categoria ? (
                              <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted px-2 py-px text-[10.5px] font-medium">
                                {it.categoria}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          {/* Orçado */}
                          <td
                            className={cn(
                              "whitespace-nowrap border-l-2 border-l-[#e4e2dd] px-3 py-2.5 text-right font-mono text-xs",
                              FUNDO_ORCADO,
                              GRADE_ORCADO,
                            )}
                          >
                            {formatCurrency(it.orcUnit, moeda)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              FUNDO_ORCADO,
                              GRADE_ORCADO,
                            )}
                          >
                            {it.orcQt}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              FUNDO_ORCADO,
                              GRADE_ORCADO,
                            )}
                          >
                            {it.orcDm}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-semibold",
                              FUNDO_ORCADO,
                            )}
                          >
                            {formatCurrency(it.orcTotal, moeda)}
                          </td>
                          {/* Planejado */}
                          <td
                            className={cn(
                              "whitespace-nowrap border-l-2 border-l-[#cfe0f7] px-3 py-2.5 text-right font-mono text-xs",
                              FUNDO_PLANEJADO,
                              GRADE_PLANEJADO,
                            )}
                          >
                            {moedaOuTraco(it.planUnit, moeda)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              FUNDO_PLANEJADO,
                              GRADE_PLANEJADO,
                            )}
                          >
                            {numeroOuTraco(it.planQt)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              FUNDO_PLANEJADO,
                              GRADE_PLANEJADO,
                            )}
                          >
                            {numeroOuTraco(it.planDm)}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-semibold",
                              FUNDO_PLANEJADO,
                            )}
                          >
                            {moedaOuTraco(it.planTotal, moeda)}
                          </td>
                          {/* Realizado */}
                          <td
                            className={cn(
                              "whitespace-nowrap border-l-2 border-l-[#f0c874] px-3 py-2.5 text-right font-mono text-xs",
                              FUNDO_REALIZADO,
                              GRADE_REALIZADO,
                            )}
                          >
                            {moedaOuTraco(it.realUnit, moeda)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              FUNDO_REALIZADO,
                              GRADE_REALIZADO,
                            )}
                          >
                            {numeroOuTraco(it.realQt)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              FUNDO_REALIZADO,
                              GRADE_REALIZADO,
                            )}
                          >
                            {numeroOuTraco(it.realDm)}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-semibold",
                              FUNDO_REALIZADO,
                            )}
                          >
                            {moedaOuTraco(it.realTotal, moeda)}
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                <td
                  colSpan={3}
                  className="border-t border-t-border px-3 py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground"
                >
                  Total do job
                </td>
                <td
                  colSpan={3}
                  className="border-l-2 border-t-2 border-l-[#d7d7d7] border-t-[#282828] bg-[#f1f0ec]"
                />
                <td className="whitespace-nowrap border-t-2 border-t-[#282828] bg-[#f1f0ec] px-3 py-3 text-right font-mono text-[13px] font-bold">
                  {formatCurrency(job.orcado, moeda)}
                </td>
                <td
                  colSpan={3}
                  className="border-l-2 border-t-2 border-l-[#b9d1f4] border-t-[#2f6fdb] bg-[#e8f0fd]"
                />
                <td className="whitespace-nowrap border-t-2 border-t-[#2f6fdb] bg-[#e8f0fd] px-3 py-3 text-right font-mono text-[13px] font-bold text-[#1e4fa3]">
                  {moedaOuTraco(job.planejado, moeda)}
                </td>
                <td
                  colSpan={3}
                  className="border-l-2 border-t-2 border-l-[#f0c874] border-t-[#d97706] bg-[#fef3c7]"
                />
                <td className="whitespace-nowrap border-t-2 border-t-[#d97706] bg-[#fef3c7] px-3 py-3 text-right font-mono text-[13px] font-bold text-[#92400e]">
                  {moedaOuTraco(job.realizado, moeda)}
                </td>
              </tr>
              <tr>
                <td
                  colSpan={3}
                  className="border-t border-t-border px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground"
                >
                  Rentabilidade
                </td>
                <td
                  colSpan={4}
                  className="border-l-2 border-t border-l-[#d7d7d7] border-t-[#e4e2dd] bg-[#f1f0ec]"
                />
                <td
                  colSpan={3}
                  className="border-l-2 border-t border-l-[#b9d1f4] border-t-[#cfe0f7] bg-[#e8f0fd]"
                />
                <td className="whitespace-nowrap border-t border-t-[#cfe0f7] bg-[#e8f0fd] px-3 py-2.5 text-right">
                  <CelulaRentabilidade
                    orcado={job.orcado}
                    custo={job.planejado}
                    moeda={moeda}
                    corValor="text-[#1e4fa3]"
                    corPercentual="text-[#5a76a8]"
                  />
                </td>
                <td
                  colSpan={3}
                  className="border-l-2 border-t border-l-[#f0c874] border-t-[#f0c874] bg-[#fef3c7]"
                />
                <td className="whitespace-nowrap border-t border-t-[#f0c874] bg-[#fef3c7] px-3 py-2.5 text-right">
                  <CelulaRentabilidade
                    orcado={job.orcado}
                    custo={job.realizado}
                    moeda={moeda}
                    corValor="text-[#92400e]"
                    corPercentual="text-[#a3703a]"
                  />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
