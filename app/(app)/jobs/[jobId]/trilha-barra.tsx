/**
 * Uma linha da barra de ações do job com o nome da frente à esquerda —
 * "Faturamento" ou "Encerramento" (decisão 087, 16/09/2026).
 *
 * As duas frentes correm separadas: o job pode ser faturado sem estar
 * encerrado e encerrado sem estar faturado. Cada trilha diz onde está a sua
 * frente e carrega a própria ação; a barra continua UMA só, com a mesma
 * largura de antes.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export function TrilhaBarra({
  rotulo,
  children,
  acoes,
  separada = false,
}: {
  rotulo: string;
  children: React.ReactNode;
  acoes?: React.ReactNode;
  /** Fio acima: a segunda trilha da barra. */
  separada?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 px-5 py-2",
        separada && "border-t border-border",
      )}
    >
      <span className="w-24 flex-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
      {acoes && (
        <div className="flex flex-wrap items-center gap-2.5">{acoes}</div>
      )}
    </div>
  );
}

/** Texto de apoio de uma trilha. */
export function TextoTrilha({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}
