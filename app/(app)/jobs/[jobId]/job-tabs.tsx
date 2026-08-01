"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  info: React.ReactNode;
  rentabilidade: React.ReactNode;
}

type TabKey = "info" | "rentabilidade";

export function JobTabs({ info, rentabilidade }: Props) {
  const [tab, setTab] = React.useState<TabKey>("info");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções do job"
        className="flex items-center gap-1 border-b border-border"
      >
        <TabButton
          active={tab === "info"}
          onClick={() => setTab("info")}
        >
          Informações do Job
        </TabButton>
        <TabButton
          active={tab === "rentabilidade"}
          onClick={() => setTab("rentabilidade")}
        >
          Rentabilidade
        </TabButton>
      </div>

      <div
        role="tabpanel"
        aria-hidden={tab !== "info"}
        className={cn(tab === "info" ? "" : "hidden")}
      >
        {info}
      </div>
      <div
        role="tabpanel"
        aria-hidden={tab !== "rentabilidade"}
        className={cn(tab === "rentabilidade" ? "" : "hidden")}
      >
        {rentabilidade}
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
        "px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
