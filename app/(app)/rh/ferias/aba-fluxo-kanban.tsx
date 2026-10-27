"use client";

import type { RhFeriasFluxoRow, ColunaFluxoFerias } from "@/lib/types";
import { classificarColunaFluxo } from "@/lib/ferias/classificar-coluna-fluxo";

// ---------------------------------------------------------------------------
// Configuração das colunas
// ---------------------------------------------------------------------------

type ColConfig = {
  key: ColunaFluxoFerias;
  titulo: string;
  cor: string; // classes Tailwind para header
};

const COLUNAS: ColConfig[] = [
  {
    key: "pendente",
    titulo: "Pendente",
    cor: "bg-amber-50 border-amber-200 text-amber-800",
  },
  {
    key: "em_andamento",
    titulo: "Em andamento",
    cor: "bg-sky-50 border-sky-200 text-sky-800",
  },
  {
    key: "enviada",
    titulo: "Enviada",
    cor: "bg-violet-50 border-violet-200 text-violet-800",
  },
  {
    key: "parcial",
    titulo: "Parcial",
    cor: "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-800",
  },
  {
    key: "finalizada",
    titulo: "Finalizada",
    cor: "bg-slate-100 border-slate-300 text-slate-700",
  },
];

// ---------------------------------------------------------------------------
// Ordenação por coluna
// ---------------------------------------------------------------------------

function ordenarRows(rows: RhFeriasFluxoRow[], coluna: ColunaFluxoFerias): RhFeriasFluxoRow[] {
  const copia = [...rows];

  switch (coluna) {
    case "pendente":
      return copia.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

    case "em_andamento":
      return copia.sort((a, b) => {
        // nulls last
        if (!a.vencimento_mais_proximo && !b.vencimento_mais_proximo) return 0;
        if (!a.vencimento_mais_proximo) return 1;
        if (!b.vencimento_mais_proximo) return -1;
        return (
          new Date(a.vencimento_mais_proximo).getTime() -
          new Date(b.vencimento_mais_proximo).getTime()
        );
      });

    case "enviada":
    case "parcial":
    case "finalizada":
      return copia.sort((a, b) => {
        if (!a.aprovado_em && !b.aprovado_em) return 0;
        if (!a.aprovado_em) return 1;
        if (!b.aprovado_em) return -1;
        return new Date(b.aprovado_em).getTime() - new Date(a.aprovado_em).getTime();
      });
  }
}

// ---------------------------------------------------------------------------
// Agrupamento
// ---------------------------------------------------------------------------

function agrupar(rows: RhFeriasFluxoRow[]): Record<ColunaFluxoFerias, RhFeriasFluxoRow[]> {
  const grupos: Record<ColunaFluxoFerias, RhFeriasFluxoRow[]> = {
    pendente: [],
    em_andamento: [],
    enviada: [],
    parcial: [],
    finalizada: [],
  };

  for (const row of rows) {
    const coluna = classificarColunaFluxo(row);
    grupos[coluna].push(row);
  }

  // Ordenar cada grupo
  for (const col of COLUNAS) {
    grupos[col.key] = ordenarRows(grupos[col.key], col.key);
  }

  return grupos;
}

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------

function PlaceholderCard({ row }: { row: RhFeriasFluxoRow }) {
  return (
    <div className="rounded border bg-white p-3 text-xs">
      Lançamento {row.lancamento_id.slice(0, 8)}
    </div>
  );
}

function ColunaKanban({ config, rows }: { config: ColConfig; rows: RhFeriasFluxoRow[] }) {
  return (
    <div className="flex flex-col min-w-0">
      {/* Header */}
      <div
        className={`flex items-center gap-2 rounded-t border px-3 py-2 ${config.cor}`}
      >
        <span className="font-medium text-sm truncate">{config.titulo}</span>
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold border ${config.cor}`}
        >
          {rows.length}
        </span>
      </div>

      {/* Cards */}
      <div
        className="flex flex-col gap-2 overflow-y-auto rounded-b border border-t-0 bg-gray-50 p-2"
        style={{ maxHeight: "calc(100vh - 16rem)" }}
      >
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nada aqui.</p>
        ) : (
          rows.map((row) => <PlaceholderCard key={row.lancamento_id} row={row} />)
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export function FluxoKanban({ rows }: { rows: RhFeriasFluxoRow[] }) {
  const grupos = agrupar(rows);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {COLUNAS.map((col) => (
        <ColunaKanban key={col.key} config={col} rows={grupos[col.key]} />
      ))}
    </div>
  );
}
