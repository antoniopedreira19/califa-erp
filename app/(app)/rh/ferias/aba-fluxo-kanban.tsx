"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { RhFeriasFluxoRow, ColunaFluxoFerias } from "@/lib/types";
import { classificarColunaFluxo } from "@/lib/ferias/classificar-coluna-fluxo";
import { CardFluxo } from "./card-fluxo";
import { ModalDocumentos } from "./modal-documentos";
import type { FolhaDoc } from "./modal-documentos";

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
    titulo: "Pendentes de aprovação",
    cor: "bg-amber-50 border-amber-200 text-amber-800",
  },
  {
    key: "em_andamento",
    titulo: "Em andamento",
    cor: "bg-sky-50 border-sky-200 text-sky-800",
  },
  {
    key: "enviada",
    titulo: "Enviadas",
    cor: "bg-violet-50 border-violet-200 text-violet-800",
  },
  {
    key: "parcial",
    titulo: "Parcialmente paga",
    cor: "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-800",
  },
  {
    key: "finalizada",
    titulo: "Finalizadas",
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

function ColunaKanban({
  config,
  rows,
  onCardClick,
}: {
  config: ColConfig;
  rows: RhFeriasFluxoRow[];
  onCardClick: (row: RhFeriasFluxoRow) => void;
}) {
  return (
    <div className="flex flex-col min-w-0">
      {/* Header */}
      <div
        className={`flex items-center gap-2 rounded-t border px-3 py-2 ${config.cor}`}
      >
        <span className="font-medium text-sm truncate">{config.titulo}</span>
        <span
          className="ml-auto shrink-0 rounded-full bg-white border border-border px-2 py-0.5 text-xs font-semibold text-foreground"
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
          rows.map((row) => (
            <CardFluxo
              key={row.lancamento_id}
              row={row}
              coluna={config.key}
              onClick={onCardClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

type FluxoKanbanProps = {
  rows: RhFeriasFluxoRow[];
  folhasPorLancamento: Record<string, FolhaDoc[]>;
};

export function FluxoKanban({ rows, folhasPorLancamento }: FluxoKanbanProps) {
  const router = useRouter();
  const grupos = agrupar(rows);

  // Estado para o modal de documentos
  const [rowSelecionado, setRowSelecionado] = React.useState<RhFeriasFluxoRow | null>(null);
  const [colunaSelecionada, setColunaSelecionada] = React.useState<ColunaFluxoFerias>("em_andamento");

  const abrirModalDocs = React.useCallback(
    (row: RhFeriasFluxoRow) => {
      const coluna = classificarColunaFluxo(row);
      // Só abre modal para colunas que têm detalhes de doc
      if (coluna === "pendente") return;
      setRowSelecionado(row);
      setColunaSelecionada(coluna);
    },
    [],
  );

  function fecharModal() {
    setRowSelecionado(null);
  }

  function handleSucesso() {
    setRowSelecionado(null);
    router.refresh();
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {COLUNAS.map((col) => (
          <ColunaKanban
            key={col.key}
            config={col}
            rows={grupos[col.key]}
            onCardClick={abrirModalDocs}
          />
        ))}
      </div>

      {rowSelecionado && (
        <ModalDocumentos
          row={rowSelecionado}
          folhas={folhasPorLancamento[rowSelecionado.lancamento_id] ?? []}
          coluna={colunaSelecionada}
          open
          onClose={fecharModal}
          onSucesso={handleSucesso}
        />
      )}
    </>
  );
}
