"use client";

import * as React from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import {
  classificarRentBadge,
  computarResultado,
  type GrupoRentabilidade,
  type ModoRentabilidade,
  type VisaoRentabilidade,
} from "@/lib/relatorios/rentabilidade";
import type { LinhaJobRentabilidade } from "@/lib/types";

interface Props {
  visao: VisaoRentabilidade;
  modo: ModoRentabilidade;
  grupos: GrupoRentabilidade[];
  totalBases: {
    faturamento: number;
    imposto: number;
    custo: number;
    bv: number;
  };
}

export function TabelaRentabilidade({
  visao,
  modo,
  grupos,
  totalBases,
}: Props) {
  // Padrão: todos os grupos EXPANDIDOS. Rastreamos os RECOLHIDOS —
  // set vazio = tudo aberto, que é o comportamento esperado por default.
  const [recolhidos, setRecolhidos] = React.useState<Set<string>>(new Set());

  const toggleRecolher = (chave: string) => {
    setRecolhidos((s) => {
      const novo = new Set(s);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  };

  // Total = base filtrada; Rent% do total recalculado via helper único.
  const { resultadoOperacional: resultOpTotal, resultadoGeral: rentTotalPct } =
    computarResultado(totalBases);

  const rotuloVisao =
    visao === "cliente" ? "Clientes" : visao === "marca" ? "Marcas" : "Jobs";

  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum resultado encontrado com os filtros atuais.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">{rotuloVisao}</th>
            <th className="px-4 py-3 text-right font-semibold">Faturamento</th>
            <th className="px-4 py-3 text-right font-semibold">Result. Op</th>
            <th className="px-4 py-3 text-center font-semibold">Rent %</th>
            <th className="px-4 py-3 text-center font-semibold">Rep %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {/* Linha total */}
          <tr className="bg-muted/20 font-bold">
            <td className="px-4 py-3">{rotuloVisao}</td>
            <td className="px-4 py-3 text-right font-mono">
              {formatCurrency(totalBases.faturamento, "BRL")}
            </td>
            <td className="px-4 py-3 text-right font-mono">
              {resultOpTotal === null ? "—" : formatCurrency(resultOpTotal, "BRL")}
            </td>
            <td className="px-4 py-3 text-center">
              <BadgeRent pct={rentTotalPct} />
            </td>
            <td className="px-4 py-3 text-center">
              <BadgeRep pct={100} isTotal />
            </td>
          </tr>

          {grupos.map((g) => {
            const expandido = !recolhidos.has(g.chave);
            const podeExpandir = visao !== "job";
            return (
              <React.Fragment key={g.chave}>
                <tr
                  className={cn(
                    "transition-colors",
                    podeExpandir && "cursor-pointer hover:bg-muted/40",
                  )}
                  onClick={
                    podeExpandir ? () => toggleRecolher(g.chave) : undefined
                  }
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      {podeExpandir ? (
                        expandido ? (
                          <ChevronDown className="h-4 w-4 text-california-red" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-california-red" />
                        )
                      ) : (
                        <span className="w-4" />
                      )}
                      {g.rotulo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(g.bases.faturamento, "BRL")}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {g.bases.resultadoOperacional === null
                      ? "—"
                      : formatCurrency(g.bases.resultadoOperacional, "BRL")}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <BadgeRent pct={g.bases.resultadoGeral} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <BadgeRep pct={g.representatividadePct} />
                  </td>
                </tr>

                {expandido &&
                  g.jobs.map((j) => {
                    const fatJ = faturamentoDaLinha(j, modo);
                    const resultOpJ = resultOpDaLinha(j, modo);
                    return (
                      <tr key={j.job_id} className="bg-muted/10">
                        <td className="px-4 py-2 pl-12 text-muted-foreground">
                          {j.job_codigo} · {j.job_nome}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                          {formatCurrency(fatJ, "BRL")}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                          {resultOpJ === null ? "—" : formatCurrency(resultOpJ, "BRL")}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <BadgeRent pct={rentDaLinha(j, modo)} />
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-muted-foreground">
                          {totalBases.faturamento > 0
                            ? `${((fatJ / totalBases.faturamento) * 100)
                                .toFixed(1)
                                .replace(".", ",")}%`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Helpers de linha individual — mesma fórmula, sobre o job sozinho.
// `modo` vem via prop e é o mesmo que o server usou pra agregar (spec §5.4).
function faturamentoDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade) {
  return modo === "previsto" ? l.faturamento_previsto : l.faturamento_realizado;
}
function impostoDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade) {
  return modo === "previsto" ? l.imposto_previsto : l.imposto_realizado;
}
function basesDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade) {
  return {
    faturamento: faturamentoDaLinha(l, modo),
    imposto: impostoDaLinha(l, modo),
    custo: l.custo_realizado,
    bv: l.bv_realizado,
  };
}
function resultOpDaLinha(l: LinhaJobRentabilidade, modo: ModoRentabilidade) {
  return computarResultado(basesDaLinha(l, modo)).resultadoOperacional;
}
function rentDaLinha(
  l: LinhaJobRentabilidade,
  modo: ModoRentabilidade,
): number | null {
  return computarResultado(basesDaLinha(l, modo)).resultadoGeral;
}

function BadgeRent({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const classe = classificarRentBadge(pct);
  const cor = {
    verde: "bg-emerald-100 text-emerald-800",
    laranja: "bg-orange-100 text-orange-800",
    vermelho: "bg-california-red/10 text-california-red",
  }[classe];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold font-mono",
        cor,
      )}
    >
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}

function BadgeRep({ pct, isTotal = false }: { pct: number; isTotal?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold font-mono",
        isTotal
          ? "bg-emerald-100 text-emerald-800"
          : "bg-orange-100 text-orange-800",
      )}
    >
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}
