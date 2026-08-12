"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** Conteúdo da aba de PPs (já pronto, vindo da page.tsx). */
  pps: React.ReactNode;
  /** Contagem de PPs em avaliação — vira badge. */
  ppsPendentesCount: number;
  /** Conteúdo da aba de avulsas. */
  avulsas: React.ReactNode;
  /** Contagem de avulsas pendentes — vira badge. */
  avulsasPendentesCount?: number;
  /** Conteúdo da aba de recorrências. */
  recorrentes: React.ReactNode;
  /** Contagem de recorrências ativas — vira badge. */
  recorrentesAtivasCount: number;
}

type TabKey = "pps" | "avulsas" | "recorrentes";

export function ContasPagarTabs({
  pps,
  ppsPendentesCount,
  avulsas,
  avulsasPendentesCount,
  recorrentes,
  recorrentesAtivasCount,
}: Props) {
  const [tab, setTab] = React.useState<TabKey>("pps");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções de contas a pagar"
        className="flex items-center gap-1 border-b border-border"
      >
        <TabButton active={tab === "pps"} onClick={() => setTab("pps")}>
          Pedidos de Compra
          {ppsPendentesCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {ppsPendentesCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "avulsas"} onClick={() => setTab("avulsas")}>
          Lançamentos Avulsos
          {(avulsasPendentesCount ?? 0) > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {avulsasPendentesCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "recorrentes"} onClick={() => setTab("recorrentes")}>
          Recorrências
          {recorrentesAtivasCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {recorrentesAtivasCount}
            </span>
          )}
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
        aria-hidden={tab !== "avulsas"}
        className={cn(tab === "avulsas" ? "" : "hidden")}
      >
        {avulsas}
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
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
