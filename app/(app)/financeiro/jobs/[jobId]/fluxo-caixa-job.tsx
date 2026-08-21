"use client";

import * as React from "react";
import { ChevronRight, TrendingUp } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
// `import type` de propósito: `fluxo-do-job.ts` importa o cliente
// Supabase de servidor, e um import de VALOR arrastaria `next/headers`
// para o bundle do cliente. Tipo é apagado na compilação; `rotuloMes`
// mora aqui embaixo justamente por isso.
import type {
  ClasseFluxo,
  DetalheFluxo,
  FluxoDoJob,
} from "./fluxo-do-job";

export interface PrazoDoJob {
  rotulo: string;
  dias: number | null;
  detalhe: string;
}

interface Props {
  fluxo: FluxoDoJob;
  prazos: PrazoDoJob[];
  moeda: string;
}

type Tom = "entrada" | "saida";

interface SubLinha {
  chave: string;
  rotulo: string;
  sub: string;
  classe: ClasseFluxo;
  tom: Tom;
  valores: number[];
  detalhes?: DetalheFluxo[];
  detalheTitulo?: string;
}

/**
 * A aba "Fluxo de Caixa do Job".
 *
 * A matriz é período × natureza, e cada natureza abre nas TRÊS classes de
 * `vw_fluxo_caixa`: o que já passou pela conta, o que tem documento em
 * aberto e o que ainda é só a previsão gravada na abertura. É a mesma
 * separação do Fluxo de Caixa geral — aqui filtrada num job só.
 *
 * As duas linhas de título expandem nos documentos por trás delas, porque
 * a pergunta que vem logo depois de ver o número é sempre "de qual PP é
 * isso?".
 */
export function FluxoCaixaDoJob({ fluxo, prazos, moeda }: Props) {
  const [abertos, setAbertos] = React.useState<Record<string, boolean>>({});

  const subLinhas = (tom: Tom): SubLinha[] => {
    const valores = tom === "entrada" ? fluxo.entradas : fluxo.saidas;
    const detalhes =
      tom === "entrada" ? fluxo.detalhesReceber : fluxo.detalhesPagar;

    return [
      {
        chave: `${tom}-movimento`,
        rotulo: "Já movimentado na conta",
        sub:
          tom === "entrada" ? "recebimentos do cliente" : "PPs e contas pagas",
        classe: "movimento",
        tom,
        valores: valores.movimento,
      },
      {
        chave: `${tom}-titulo`,
        rotulo:
          tom === "entrada"
            ? "Títulos em aberto (a receber)"
            : "Títulos em aberto (a pagar)",
        sub:
          detalhes.length === 0
            ? "nenhum documento em aberto"
            : `${detalhes.length} ${detalhes.length === 1 ? "título" : "títulos"} · clique para ver`,
        classe: "titulo",
        tom,
        valores: valores.titulo,
        detalhes,
        detalheTitulo:
          tom === "entrada"
            ? "Notas emitidas deste job"
            : "PPs e contas que geraram estes títulos",
      },
      {
        chave: `${tom}-previsao`,
        rotulo: "Só previsão (abertura do job)",
        sub:
          tom === "entrada"
            ? "parcelas de recebimento"
            : "curva de desembolso",
        classe: "previsao",
        tom,
        valores: valores.previsao,
      },
    ];
  };

  const totalDe = (tom: Tom) => {
    const v = tom === "entrada" ? fluxo.entradas : fluxo.saidas;
    return fluxo.meses.map(
      (_, i) => v.movimento[i] + v.titulo[i] + v.previsao[i],
    );
  };

  const colunas = fluxo.meses.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-4 w-4 text-california-red" />
          <h2 className="text-base font-bold tracking-tight">
            Fluxo de caixa do job
          </h2>
        </div>
        <p className="min-w-[260px] flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Só o que passa por este job: o realizado (movimentos das contas) mais
          o previsto (títulos em aberto e as previsões da abertura).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CardSaldo
          rotulo="Saldo do job hoje"
          valor={fluxo.saldoHoje}
          moeda={moeda}
          nota="Entradas menos saídas já movimentadas"
        />
        <CardSaldo
          rotulo="Saldo no fim do job"
          valor={fluxo.saldoFim}
          moeda={moeda}
          nota={`Projeção até ${fluxo.ultimoMesLabel}`}
          destacarPositivo
        />
      </div>

      <div className="rounded-2xl border border-border bg-card px-[22px] pb-[18px] pt-4 shadow-soft">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
          Prazos do job
        </p>
        <div className="grid gap-3.5 sm:grid-cols-3">
          {prazos.map((p) => (
            <div
              key={p.rotulo}
              className="rounded-xl border border-border px-[15px] py-[13px]"
            >
              <p className="text-[11px] text-muted-foreground">{p.rotulo}</p>
              <p className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-mono text-[19px] font-bold">
                  {p.dias === null ? "—" : p.dias}
                </span>
                {p.dias !== null && (
                  <span className="text-[11.5px] text-muted-foreground">
                    dias
                  </span>
                )}
              </p>
              <p className="mt-1 text-[11px] text-[#8a8a8a]">{p.detalhe}</p>
            </div>
          ))}
        </div>
      </div>

      {colunas === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-soft">
          Este job ainda não tem movimento, título nem previsão no fluxo de
          caixa.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[900px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[280px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                  Período
                </th>
                {fluxo.meses.map((m, i) => (
                  <th
                    key={m}
                    className={cn(
                      "min-w-[120px] px-4 py-2.5 text-right",
                      i === fluxo.indiceEmCurso &&
                        "border-x border-california-red/25 bg-california-red/[0.04]",
                    )}
                  >
                    <span className="block font-mono text-xs font-bold text-foreground">
                      {rotuloMes(m)}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-[9.5px] font-bold uppercase tracking-[0.07em]",
                        i === fluxo.indiceEmCurso
                          ? "text-california-red"
                          : "text-[#8a8a8a]",
                      )}
                    >
                      {i < fluxo.indiceEmCurso || fluxo.indiceEmCurso === -1
                        ? "Realizado"
                        : i === fluxo.indiceEmCurso
                          ? "Em curso"
                          : "Previsto"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["entrada", "saida"] as Tom[]).map((tom) => (
                <React.Fragment key={tom}>
                  <tr className="border-t border-border bg-[#f8f7f7]/60">
                    <td className="px-5 py-[11px] text-[13.5px] font-bold">
                      {tom === "entrada" ? "Entradas" : "Saídas"}
                    </td>
                    {totalDe(tom).map((v, i) => (
                      <Celula key={i} valor={v} tom={tom} moeda={moeda} />
                    ))}
                  </tr>

                  {subLinhas(tom).map((linha) => {
                    const expansivel = (linha.detalhes?.length ?? 0) > 0;
                    const aberto = Boolean(abertos[linha.chave]);
                    return (
                      <React.Fragment key={linha.chave}>
                        <tr
                          className={cn(
                            "border-t border-[#f4f2f2]",
                            expansivel && "cursor-pointer hover:bg-muted/40",
                          )}
                          onClick={
                            expansivel
                              ? () =>
                                  setAbertos((a) => ({
                                    ...a,
                                    [linha.chave]: !a[linha.chave],
                                  }))
                              : undefined
                          }
                        >
                          <td className="py-[9px] pl-[30px] pr-5 text-muted-foreground">
                            <span className="flex items-center gap-[7px]">
                              {expansivel && (
                                <ChevronRight
                                  className={cn(
                                    "h-3 w-3 shrink-0 text-[#8a8a8a] transition-transform",
                                    aberto && "rotate-90",
                                  )}
                                />
                              )}
                              <span className="text-[12.5px]">
                                {linha.rotulo}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-[#8a8a8a]">
                              {linha.sub}
                            </span>
                          </td>
                          {linha.valores.map((v, i) => (
                            <Celula key={i} valor={v} tom={tom} moeda={moeda} />
                          ))}
                        </tr>

                        {aberto && linha.detalhes && (
                          <tr>
                            <td
                              colSpan={colunas + 1}
                              className="border-t border-[#f4f2f2] bg-[#f8f7f7]/55 p-0"
                            >
                              <div className="flex flex-col gap-1.5 py-2.5 pl-11 pr-5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8a8a8a]">
                                  {linha.detalheTitulo}
                                </p>
                                {linha.detalhes.map((d) => (
                                  <div
                                    key={d.chave}
                                    className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-white px-3 py-[9px]"
                                  >
                                    <span className="font-mono text-xs font-bold text-california-red">
                                      {d.codigo}
                                    </span>
                                    <span className="min-w-0 flex-1 text-[12.5px]">
                                      {d.descricao}
                                    </span>
                                    <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
                                      venc. {formatDataBr(d.vencimento)}
                                    </span>
                                    <span className="whitespace-nowrap font-mono text-[12.5px] font-semibold">
                                      {formatCurrency(d.valor, moeda)}
                                    </span>
                                    <span
                                      className={cn(
                                        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.05em]",
                                        d.situacao === "Vencido"
                                          ? "border-california-red/30 bg-california-red/[0.06] text-[#b3323c]"
                                          : "border-amber-200 bg-amber-50 text-amber-700",
                                      )}
                                    >
                                      {d.situacao}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              ))}

              <tr className="border-t border-border">
                <td className="px-5 py-[11px] text-[13px] font-semibold">
                  Líquido do período
                </td>
                {fluxo.liquido.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      "whitespace-nowrap px-4 py-[11px] text-right font-mono text-[12.5px] font-semibold",
                      v > 0
                        ? "text-emerald-700"
                        : v < 0
                          ? "text-[#b3323c]"
                          : "text-[#c9c9c9]",
                    )}
                  >
                    {v === 0 ? "–" : formatCurrency(v, moeda)}
                  </td>
                ))}
              </tr>

              <tr className="border-t-2 border-foreground bg-[#f8f7f7]/90">
                <td className="px-5 py-3 text-[13px] font-bold">
                  Saldo acumulado do job
                </td>
                {fluxo.saldo.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      "whitespace-nowrap px-4 py-3 text-right font-mono text-[13px] font-bold",
                      v < 0 ? "text-[#b3323c]" : "text-foreground",
                    )}
                  >
                    {formatCurrency(v, moeda)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Celula({
  valor,
  tom,
  moeda,
}: {
  valor: number;
  tom: Tom;
  moeda: string;
}) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-4 py-[11px] text-right font-mono text-[12.5px]",
        valor > 0
          ? tom === "entrada"
            ? "font-semibold text-emerald-700"
            : "font-semibold text-[#b3323c]"
          : "text-[#c9c9c9]",
      )}
    >
      {valor > 0 ? formatCurrency(valor, moeda) : "–"}
    </td>
  );
}

function CardSaldo({
  rotulo,
  valor,
  moeda,
  nota,
  destacarPositivo,
}: {
  rotulo: string;
  valor: number;
  moeda: string;
  nota: string;
  destacarPositivo?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-[22px] py-[18px] shadow-soft">
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-1.5 font-mono text-2xl font-bold",
          valor < 0
            ? "text-[#b3323c]"
            : destacarPositivo
              ? "text-emerald-700"
              : "text-foreground",
        )}
      >
        {formatCurrency(valor, moeda)}
      </p>
      <p className="mt-1 text-[11.5px] text-muted-foreground">{nota}</p>
    </div>
  );
}

/** "2026-08" → "08/2026", que é como o protótipo rotula a coluna. */
function rotuloMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${m}/${ano}`;
}

function formatDataBr(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}
