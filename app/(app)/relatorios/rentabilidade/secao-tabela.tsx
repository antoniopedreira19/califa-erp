"use client";

import { TabelaRentabilidade } from "./tabela-rentabilidade";
import { TabelaComparativo } from "./tabela-comparativo";
import { useModo } from "./modo-provider";
import type {
  GrupoRentabilidade,
  VisaoRentabilidade,
} from "@/lib/relatorios/rentabilidade";

type TotalBases = {
  faturamento: number;
  imposto: number;
  custo: number;
  bv: number;
};

interface Props {
  visao: VisaoRentabilidade;
  // Dados pré-computados dos DOIS modos — o cliente escolhe qual mostrar
  // via `useModo()`, sem disparar navegação.
  gruposA: { previsto: GrupoRentabilidade[]; realizado: GrupoRentabilidade[] };
  totalBasesA: { previsto: TotalBases; realizado: TotalBases };
  // Comparativo (opcional). `null` quando o toggle "Comparar 2 períodos"
  // está desligado; o server nem calcula gruposB nesse caso.
  gruposB: {
    previsto: GrupoRentabilidade[];
    realizado: GrupoRentabilidade[];
  } | null;
  anoB: number | null;
  anoA: number;
}

export function SecaoTabela({
  visao,
  gruposA,
  totalBasesA,
  gruposB,
  anoA,
  anoB,
}: Props) {
  const { modo } = useModo();

  const grupos = gruposA[modo];
  const totalBases = totalBasesA[modo];

  if (gruposB && anoB !== null) {
    return (
      <TabelaComparativo
        visao={visao}
        gruposA={grupos}
        gruposB={gruposB[modo]}
        anoA={anoA}
        anoB={anoB}
      />
    );
  }

  return (
    <TabelaRentabilidade
      visao={visao}
      modo={modo}
      grupos={grupos}
      totalBases={totalBases}
    />
  );
}
