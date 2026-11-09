"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  faturamento: React.ReactNode;
  faturamentoCount: number;
  titulos: React.ReactNode;
  titulosCount: number;
  /** Decisão 247: os créditos de save por cliente. */
  creditos: React.ReactNode;
}

type TabKey = "faturamento" | "titulos" | "creditos";

export function ContasReceberTabs({
  faturamento,
  faturamentoCount,
  titulos,
  titulosCount,
  creditos,
}: Props) {
  // `?aba=creditos` abre direto nos créditos de save.
  const aba = useSearchParams()?.get("aba");
  const [tab, setTab] = React.useState<TabKey>(aba === "creditos" ? "creditos" : "faturamento");
  return (
    <div className="space-y-6">
      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "faturamento"} onClick={() => setTab("faturamento")}>
          Faturamento
          {faturamentoCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {faturamentoCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "titulos"} onClick={() => setTab("titulos")}>
          Títulos a Receber
          {titulosCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {titulosCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "creditos"} onClick={() => setTab("creditos")}>
          Créditos de save
        </TabButton>
      </div>

      <div role="tabpanel" className={cn(tab === "faturamento" ? "" : "hidden")}>
        {faturamento}
      </div>
      <div role="tabpanel" className={cn(tab === "titulos" ? "" : "hidden")}>
        {titulos}
      </div>
      <div role="tabpanel" className={cn(tab === "creditos" ? "" : "hidden")}>
        {creditos}
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
        "inline-flex items-center px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
