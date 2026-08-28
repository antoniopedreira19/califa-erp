"use client";

import * as React from "react";
import { formatCurrency, cn } from "@/lib/utils";
import {
  classificarRentBadge,
  computarResultado,
  type GrupoRentabilidade,
  type VisaoRentabilidade,
} from "@/lib/relatorios/rentabilidade";

interface Props {
  visao: VisaoRentabilidade;
  gruposA: GrupoRentabilidade[];
  gruposB: GrupoRentabilidade[];
  anoA: number;
  anoB: number;
}

/**
 * Une grupos dos 2 períodos por chave. Grupo ausente vira "R$ 0" no bloco
 * daquele período — R$ 0 tem significado ("não faturou em 2025"), não é
 * travessão. Rent% do bloco zerado mostra "—" (divisão por zero).
 */
export function TabelaComparativo({ visao, gruposA, gruposB, anoA, anoB }: Props) {
  const rotuloVisao =
    visao === "cliente" ? "Clientes" : visao === "marca" ? "Marcas" : "Jobs";

  const grupoZero = (rotulo: string): GrupoRentabilidade => ({
    chave: "",
    rotulo,
    bases: { faturamento: 0, imposto: 0, custo: 0, bv: 0, resultadoOperacional: null, resultadoGeral: null },
    jobs: [],
    representatividadePct: 0,
  });

  const chaves = new Set<string>();
  gruposA.forEach((g) => chaves.add(g.chave));
  gruposB.forEach((g) => chaves.add(g.chave));

  const linhas = Array.from(chaves).map((chave) => {
    const a = gruposA.find((g) => g.chave === chave) ?? grupoZero("");
    const b = gruposB.find((g) => g.chave === chave) ?? grupoZero("");
    const rotulo = a.rotulo || b.rotulo || chave;
    return { chave, rotulo, a, b };
  });

  linhas.sort((x, y) => y.a.bases.faturamento - x.a.bases.faturamento);

  const totalA = somaTotal(gruposA);
  const totalB = somaTotal(gruposB);

  if (linhas.length === 0) {
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
        <thead>
          <tr className="border-b border-border bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
            <th rowSpan={2} className="px-4 py-3 text-left font-semibold">{rotuloVisao} — Comparativo</th>
            <th colSpan={3} className="px-4 py-2 text-center font-semibold border-l border-border">{anoA}</th>
            <th colSpan={3} className="px-4 py-2 text-center font-semibold border-l border-border">{anoB}</th>
          </tr>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 text-right font-semibold border-l border-border">Fat.</th>
            <th className="px-4 py-2 text-right font-semibold">Result. Op</th>
            <th className="px-4 py-2 text-center font-semibold">Rent %</th>
            <th className="px-4 py-2 text-right font-semibold border-l border-border">Fat.</th>
            <th className="px-4 py-2 text-right font-semibold">Result. Op</th>
            <th className="px-4 py-2 text-center font-semibold">Rent %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr className="bg-muted/20 font-bold">
            <td className="px-4 py-3">{rotuloVisao}</td>
            <ColunasBloco bases={totalA} />
            <ColunasBloco bases={totalB} borderLeft />
          </tr>

          {linhas.map(({ chave, rotulo, a, b }) => (
            <tr key={chave} className="hover:bg-muted/20">
              <td className="px-4 py-3">{rotulo}</td>
              <ColunasBloco bases={a.bases} />
              <ColunasBloco bases={b.bases} borderLeft />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function somaTotal(grupos: GrupoRentabilidade[]) {
  const faturamento = grupos.reduce((s, g) => s + g.bases.faturamento, 0);
  const imposto = grupos.reduce((s, g) => s + g.bases.imposto, 0);
  const custo = grupos.reduce((s, g) => s + g.bases.custo, 0);
  const bv = grupos.reduce((s, g) => s + g.bases.bv, 0);
  const { resultadoOperacional, resultadoGeral } = computarResultado({
    faturamento,
    imposto,
    custo,
    bv,
  });
  return { faturamento, imposto, custo, bv, resultadoOperacional, resultadoGeral };
}

function ColunasBloco({
  bases,
  borderLeft = false,
}: {
  bases: {
    faturamento: number;
    imposto: number;
    custo: number;
    bv: number;
    resultadoOperacional: number | null;
    resultadoGeral: number | null;
  };
  borderLeft?: boolean;
}) {
  const border = borderLeft ? "border-l border-border" : "";
  return (
    <>
      <td className={cn("px-4 py-3 text-right font-mono", border)}>
        {formatCurrency(bases.faturamento, "BRL")}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        {bases.resultadoOperacional === null || bases.faturamento === 0
          ? "—"
          : formatCurrency(bases.resultadoOperacional, "BRL")}
      </td>
      <td className="px-4 py-3 text-center">
        <BadgeRent pct={bases.resultadoGeral} />
      </td>
    </>
  );
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
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold font-mono", cor)}>
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}
