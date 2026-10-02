"use client";

import * as React from "react";
import { LinhaQuadro } from "./linha-quadro";
import { ModalDetalheWrapper } from "./modal-detalhe-wrapper";
import type { QuadroColaboradorRow } from "./aba-quadro";

type Props = {
  rows: QuadroColaboradorRow[];
};

/**
 * Wrapper client-side do Quadro de Férias.
 *
 * O Quadro em si (server component) é renderizado 1x no servidor com todas
 * as linhas. Quando o RH clica numa linha, abrir/fechar modal vira state
 * LOCAL — sem round-trip pro servidor nem re-render do Quadro.
 *
 * Trade-off aceito (Onda 3): perde deep-linking do modal (`?colab=xxx`).
 * O RH abre/fecha modal várias vezes; raramente compartilha URL.
 */
export function QuadroListaCliente({ rows }: Props) {
  const [colabSelecionadoId, setColabSelecionadoId] = React.useState<
    string | null
  >(null);

  return (
    <>
      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr_1fr_0.3fr] gap-4 bg-muted/40 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span>Colaborador</span>
          <span>Admissão</span>
          <span>Aquisitivo</span>
          <span>Dias pend.</span>
          <span>Situação</span>
          <span>Data limite</span>
          <span className="sr-only">Ação</span>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <LinhaQuadro
              key={row.id}
              row={row}
              onAbrir={() => setColabSelecionadoId(row.id)}
            />
          ))}
        </ul>
      </div>

      {colabSelecionadoId && (
        <ModalDetalheWrapper
          colaboradorId={colabSelecionadoId}
          onFechar={() => setColabSelecionadoId(null)}
        />
      )}
    </>
  );
}
