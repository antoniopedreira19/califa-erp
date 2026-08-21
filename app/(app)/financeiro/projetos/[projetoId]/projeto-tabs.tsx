"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabKey = "planilha" | "fluxo";

/**
 * As duas abas da visão agregada do projeto no financeiro: a planilha
 * consolidada dos jobs e o fluxo de caixa somado deles.
 *
 * Casca própria, e não a de cinco abas do job: são outras abas e outra
 * ordem, e unificar custaria mais props condicionais do que as ~30 linhas
 * que esta duplicação custa.
 */
export function ProjetoTabs({
  planilha,
  fluxo,
}: {
  planilha: React.ReactNode;
  fluxo: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<TabKey>("planilha");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções do projeto no financeiro"
        className="flex items-center gap-1 border-b border-border"
      >
        <TabButton active={tab === "planilha"} onClick={() => setTab("planilha")}>
          Planilha Interna agregada
        </TabButton>
        <TabButton active={tab === "fluxo"} onClick={() => setTab("fluxo")}>
          Fluxo de Caixa do Projeto
        </TabButton>
      </div>

      <div
        role="tabpanel"
        aria-hidden={tab !== "planilha"}
        className={cn("flex flex-col gap-6", tab === "planilha" ? "" : "hidden")}
      >
        {planilha}
      </div>
      <div
        role="tabpanel"
        aria-hidden={tab !== "fluxo"}
        className={cn(tab === "fluxo" ? "" : "hidden")}
      >
        {fluxo}
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
        "mr-5 inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-semibold transition-colors",
        active
          ? "border-california-red text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
