"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import {
  valorNaVisao,
  type ValoresDoBloco,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";
import { jobStatusLabel, type JobStatus } from "@/lib/types";
import type { JobPlanilhaProjeto } from "./tipos";
import {
  ColunasJobsProjeto,
  LARGURA_MINIMA_JOBS_PROJETO,
} from "@/app/(app)/_planilha/grade-jobs-projeto";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";

const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";

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

/** Total de um bloco que recebe BV, com a sub-linha da dedução na vista
 *  Líquido — a mesma leitura da Planilha Interna do job. */
function TotalComBv({
  bloco,
  visao,
  moeda,
  className,
  cor,
  corRotulo,
  tamanho = "text-xs",
}: {
  bloco: ValoresDoBloco;
  visao: VisaoBv;
  moeda: string;
  className?: string;
  cor: string;
  corRotulo: string;
  tamanho?: string;
}) {
  return (
    <td className={cn("whitespace-nowrap px-3 py-2.5 text-right", className)}>
      <div className="flex flex-col items-end">
        <span className={cn("font-mono font-semibold", tamanho)}>
          {moedaOuTraco(valorNaVisao(bloco, visao), moeda)}
        </span>
        {visao === "liquido" && bloco.bruto > 0 && (
          <SubLinhaBv
            deducao={bloco.deducaoBv}
            pendente={bloco.bvPendente}
            formatar={(v) => formatCurrency(v, moeda)}
            cor={cor}
            corRotulo={corRotulo}
          />
        )}
      </div>
    </td>
  );
}

export function PlanilhaJobCard({
  job,
  jobHref,
  visao,
}: {
  job: JobPlanilhaProjeto;
  /** Bruto ou Líquido (− BV). Vem da página: a chave vale para todos os
   *  jobs do projeto e para o card de Totais, juntos. */
  visao: VisaoBv;
  /**
   * Para onde "Abrir job" leva. Default é a página de Jobs. O financeiro
   * passa `/financeiro/jobs/[id]`: aquele módulo não encaminha para telas
   * de outros (decisão do Tiago, 20/08/2026).
   */
  jobHref?: string;
}) {
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

        {/* Mesmas cores dos blocos da planilha logo abaixo — o resumo do
            job e a grade dele leem como a mesma coisa. */}
        <div className="ml-auto flex items-stretch">
          <div className={cn("px-4 text-right", ORCADO.bordaAbre)}>
            <p
              className={cn(
                "text-[9.5px] font-bold uppercase tracking-[0.09em]",
                ORCADO.textoSuave,
              )}
            >
              Orçado
            </p>
            <p
              className={cn(
                "mt-[3px] whitespace-nowrap font-mono text-[13px] font-bold",
                ORCADO.texto,
              )}
            >
              {formatCurrency(job.orcado, moeda)}
            </p>
          </div>
          <div className={cn("px-4 text-right", PLANEJADO.bordaAbre)}>
            <p
              className={cn(
                "text-[9.5px] font-bold uppercase tracking-[0.09em]",
                PLANEJADO.textoSuave,
              )}
            >
              Planejado
            </p>
            <p
              className={cn(
                "mt-[3px] whitespace-nowrap font-mono text-[13px] font-bold",
                PLANEJADO.texto,
              )}
            >
              {moedaOuTraco(valorNaVisao(job.planejado, visao), moeda)}
            </p>
          </div>
          <div className={cn("px-4 text-right", REALIZADO.bordaAbre)}>
            <p
              className={cn(
                "text-[9.5px] font-bold uppercase tracking-[0.09em]",
                REALIZADO.textoSuave,
              )}
            >
              Realizado
            </p>
            <p
              className={cn(
                "mt-[3px] whitespace-nowrap font-mono text-[13px] font-bold",
                REALIZADO.texto,
              )}
            >
              {moedaOuTraco(valorNaVisao(job.realizado, visao), moeda)}
            </p>
          </div>
        </div>

        <Link
          href={jobHref ?? `/jobs/${job.id}?from=jobs`}
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
          {/* Grade compartilhada com o card de Totais desta tela: as
              colunas Total de lá caem exatamente sob as daqui. */}
          <table
            className={cn(
              "w-full table-fixed border-collapse text-sm",
              LARGURA_MINIMA_JOBS_PROJETO,
            )}
          >
            <ColunasJobsProjeto />
            <thead>
              <tr>
                <th colSpan={3} className="border-b border-border bg-muted/40" />
                <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                  ORÇADO
                </th>
                <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                  PLANEJADO
                </th>
                <th colSpan={4} className={cn(FAIXA_ROTULO, REALIZADO.faixa)}>
                  REALIZADO
                </th>
              </tr>
              <tr className="bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="border-r border-r-border px-3 py-2 text-left">
                  Agrupamento · item
                </th>
                <th className="border-r border-r-border px-2 py-2 text-left">
                  Tipo
                </th>
                <th className="border-r border-r-border px-3 py-2 text-left">
                  Categoria
                </th>
                <th
                  className={cn("px-3 py-2 text-right", ORCADO.cabecalhoAbre)}
                >
                  R$ Unit.
                </th>
                <th
                  className={cn("px-1.5 py-2 text-right", ORCADO.cabecalhoMeio)}
                >
                  QT
                </th>
                <th
                  className={cn("px-1.5 py-2 text-right", ORCADO.cabecalhoMeio)}
                >
                  D/M
                </th>
                <th className={cn("px-3 py-2 text-right", ORCADO.cabecalhoFim)}>
                  Total
                </th>
                <th
                  className={cn(
                    "px-3 py-2 text-right",
                    PLANEJADO.cabecalhoAbre,
                  )}
                >
                  R$ Unit.
                </th>
                <th
                  className={cn(
                    "px-1.5 py-2 text-right",
                    PLANEJADO.cabecalhoMeio,
                  )}
                >
                  QT
                </th>
                <th
                  className={cn(
                    "px-1.5 py-2 text-right",
                    PLANEJADO.cabecalhoMeio,
                  )}
                >
                  D/M
                </th>
                <th
                  className={cn("px-3 py-2 text-right", PLANEJADO.cabecalhoFim)}
                >
                  Total
                </th>
                <th
                  className={cn(
                    "px-3 py-2 text-right",
                    REALIZADO.cabecalhoAbre,
                  )}
                >
                  R$ Unit.
                </th>
                <th
                  className={cn(
                    "px-1.5 py-2 text-right",
                    REALIZADO.cabecalhoMeio,
                  )}
                >
                  QT
                </th>
                <th
                  className={cn(
                    "px-1.5 py-2 text-right",
                    REALIZADO.cabecalhoMeio,
                  )}
                >
                  D/M
                </th>
                <th
                  className={cn("px-3 py-2 text-right", REALIZADO.cabecalhoFim)}
                >
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
                          ORCADO.celulaVazia,
                        )}
                      />
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold",
                          ORCADO.celulaTotal,
                        )}
                      >
                        {formatCurrency(g.orcado, moeda)}
                      </td>
                      <td
                        colSpan={3}
                        className={cn(
                          PLANEJADO.celulaVazia,
                        )}
                      />
                      <TotalComBv
                        bloco={g.planejado}
                        visao={visao}
                        moeda={moeda}
                        className={PLANEJADO.celulaTotal}
                        cor={PLANEJADO.texto}
                        corRotulo={PLANEJADO.textoSuave}
                        tamanho="text-[12.5px]"
                      />
                      <td
                        colSpan={3}
                        className={cn(
                          REALIZADO.celulaVazia,
                        )}
                      />
                      <TotalComBv
                        bloco={g.realizado}
                        visao={visao}
                        moeda={moeda}
                        className={REALIZADO.celulaTotal}
                        cor={REALIZADO.texto}
                        corRotulo={REALIZADO.textoSuave}
                        tamanho="text-[12.5px]"
                      />
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
                              "whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs",
                              ORCADO.celulaAbre,
                            )}
                          >
                            {formatCurrency(it.orcUnit, moeda)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              ORCADO.celulaMeio,
                            )}
                          >
                            {it.orcQt}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              ORCADO.celulaMeio,
                            )}
                          >
                            {it.orcDm}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-semibold",
                              ORCADO.celulaTotal,
                            )}
                          >
                            {formatCurrency(it.orcTotal, moeda)}
                          </td>
                          {/* Planejado */}
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs",
                              PLANEJADO.celulaAbre,
                            )}
                          >
                            {moedaOuTraco(it.planUnit, moeda)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              PLANEJADO.celulaMeio,
                            )}
                          >
                            {numeroOuTraco(it.planQt)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              PLANEJADO.celulaMeio,
                            )}
                          >
                            {numeroOuTraco(it.planDm)}
                          </td>
                          <TotalComBv
                            bloco={it.planejado}
                            visao={visao}
                            moeda={moeda}
                            className={PLANEJADO.celulaTotal}
                            cor={PLANEJADO.texto}
                            corRotulo={PLANEJADO.textoSuave}
                          />
                          {/* Realizado */}
                          <td
                            className={cn(
                              "whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs",
                              REALIZADO.celulaAbre,
                            )}
                          >
                            {moedaOuTraco(it.realUnit, moeda)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              REALIZADO.celulaMeio,
                            )}
                          >
                            {numeroOuTraco(it.realQt)}
                          </td>
                          <td
                            className={cn(
                              "px-1.5 py-2.5 text-right text-xs",
                              REALIZADO.celulaMeio,
                            )}
                          >
                            {numeroOuTraco(it.realDm)}
                          </td>
                          <TotalComBv
                            bloco={it.realizado}
                            visao={visao}
                            moeda={moeda}
                            className={REALIZADO.celulaTotal}
                            cor={REALIZADO.texto}
                            corRotulo={REALIZADO.textoSuave}
                          />
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
                <td colSpan={3} className={ORCADO.subtotalVazio} />
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-3 text-right font-mono text-[13px] font-bold",
                    ORCADO.subtotalValor,
                  )}
                >
                  {formatCurrency(job.orcado, moeda)}
                </td>
                <td colSpan={3} className={PLANEJADO.subtotalVazio} />
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-3 text-right font-mono text-[13px] font-bold",
                    PLANEJADO.subtotalValor,
                  )}
                >
                  {moedaOuTraco(valorNaVisao(job.planejado, visao), moeda)}
                </td>
                <td colSpan={3} className={REALIZADO.subtotalVazio} />
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-3 text-right font-mono text-[13px] font-bold",
                    REALIZADO.subtotalValor,
                  )}
                >
                  {moedaOuTraco(valorNaVisao(job.realizado, visao), moeda)}
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
                  className={cn("border-t border-t-[#dfeafb]", ORCADO.celulaVazia)}
                />
                <td
                  colSpan={3}
                  className={cn(
                    "border-t border-t-[#dcf5e8]",
                    PLANEJADO.celulaVazia,
                  )}
                />
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-right border-t border-t-[#dcf5e8]",
                    PLANEJADO.celulaTotal,
                  )}
                >
                  <CelulaRentabilidade
                    orcado={job.orcado}
                    custo={valorNaVisao(job.planejado, visao)}
                    moeda={moeda}
                    corValor={RENTAB_VALOR}
                    corPercentual={RENTAB_VALOR}
                  />
                </td>
                <td
                  colSpan={3}
                  className={cn(
                    "border-t border-t-[#fbd8b8]",
                    REALIZADO.celulaVazia,
                  )}
                />
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-right border-t border-t-[#fbd8b8]",
                    REALIZADO.celulaTotal,
                  )}
                >
                  <CelulaRentabilidade
                    orcado={job.orcado}
                    custo={valorNaVisao(job.realizado, visao)}
                    moeda={moeda}
                    corValor={RENTAB_VALOR}
                    corPercentual={RENTAB_VALOR}
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
