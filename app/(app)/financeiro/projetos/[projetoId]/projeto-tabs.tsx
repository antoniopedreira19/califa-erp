"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
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
  // A aba vive no `?aba=` (decisão 106): é por ele que a faixa do projeto
  // leva do Fluxo de Caixa do Projeto ao Fluxo de Caixa do Job, e de volta.
  // Sem `?aba=`, a planilha — como sempre foi.
  const abaNaUrl: TabKey =
    useSearchParams().get("aba") === "fluxo" ? "fluxo" : "planilha";
  const [tab, setTab] = React.useState<TabKey>(abaNaUrl);
  React.useEffect(() => {
    setTab(abaNaUrl);
  }, [abaNaUrl]);

  // Grava sem passar pelo router: a página é `force-dynamic`, e um
  // `router.replace` refaria todas as consultas só para trocar de aba.
  function irPara(nova: TabKey) {
    setTab(nova);
    const url = new URL(window.location.href);
    if (nova === "fluxo") url.searchParams.set("aba", "fluxo");
    else url.searchParams.delete("aba");
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções do projeto no financeiro"
        className="flex items-center gap-1 border-b border-border"
      >
        <TabButton active={tab === "planilha"} onClick={() => irPara("planilha")}>
          Planilha Interna agregada
        </TabButton>
        <TabButton active={tab === "fluxo"} onClick={() => irPara("fluxo")}>
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
