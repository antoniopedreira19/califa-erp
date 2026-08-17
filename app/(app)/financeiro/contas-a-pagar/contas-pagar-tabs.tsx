"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Três abas desde a Tela 3.2. A antiga "Lançamentos Avulsos" foi
 * ABSORVIDA por "Títulos a Pagar": a avulsa virou um título de origem
 * AVULSO na lista unificada, e a criação passou a ser o botão
 * "+ Lançamento Avulso" de lá.
 */
interface Props {
  /** Conteúdo da aba de PPs (já pronto, vindo da page.tsx). */
  pps: React.ReactNode;
  /** Contagem de PPs em avaliação — vira badge. */
  ppsPendentesCount: number;
  /** Conteúdo da aba unificada de títulos. */
  titulos: React.ReactNode;
  /** Quantos títulos estão a pagar — vira badge. */
  titulosAPagarCount: number;
  /** Conteúdo da aba de recorrências. */
  recorrentes: React.ReactNode;
  /** Contagem de recorrências ativas — vira badge. */
  recorrentesAtivasCount: number;
}

type TabKey = "pps" | "titulos" | "recorrentes";

export function ContasPagarTabs({
  pps,
  ppsPendentesCount,
  titulos,
  titulosAPagarCount,
  recorrentes,
  recorrentesAtivasCount,
}: Props) {
  // Abre em "Títulos a Pagar": é a aba central de saída de dinheiro, e o
  // que o financeiro faz todo dia é dar baixa, não avaliar PP.
  const [tab, setTab] = React.useState<TabKey>("titulos");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções de contas a pagar"
        className="flex items-center gap-1 border-b border-border"
      >
        <TabButton active={tab === "pps"} onClick={() => setTab("pps")} count={ppsPendentesCount}>
          Pedidos de Produção (PPs)
        </TabButton>
        <TabButton
          active={tab === "titulos"}
          onClick={() => setTab("titulos")}
          count={titulosAPagarCount}
        >
          Títulos a Pagar
        </TabButton>
        <TabButton
          active={tab === "recorrentes"}
          onClick={() => setTab("recorrentes")}
          count={recorrentesAtivasCount}
        >
          Recorrências
        </TabButton>
      </div>

      <div
        role="tabpanel"
        aria-hidden={tab !== "pps"}
        className={cn(tab === "pps" ? "" : "hidden")}
      >
        {pps}
      </div>
      <div
        role="tabpanel"
        aria-hidden={tab !== "titulos"}
        className={cn(tab === "titulos" ? "" : "hidden")}
      >
        {titulos}
      </div>
      <div
        role="tabpanel"
        aria-hidden={tab !== "recorrentes"}
        className={cn(tab === "recorrentes" ? "" : "hidden")}
      >
        {recorrentes}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count > 0 && (
        <span
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            active ? "bg-california-red text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
