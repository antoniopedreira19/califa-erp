"use client";

/**
 * Stub temporario. Task 11 substitui pela implementacao completa da
 * tabela comparativa (2 periodos lado a lado com delta em pp).
 */
import type {
  GrupoRentabilidade,
  VisaoRentabilidade,
} from "@/lib/relatorios/rentabilidade";

interface Props {
  visao: VisaoRentabilidade;
  gruposA: GrupoRentabilidade[];
  gruposB: GrupoRentabilidade[];
  anoA: number;
  anoB: number;
}

export function TabelaComparativo(_props: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card p-10 text-center">
      <p className="text-sm text-muted-foreground">
        Tabela comparativa em construção.
      </p>
    </div>
  );
}
