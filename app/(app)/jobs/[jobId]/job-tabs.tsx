"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Props {
  info: React.ReactNode;
  planilha: React.ReactNode;
  pps: React.ReactNode;
  /** Quantidade de PPs ativas — vira o badge da aba. */
  ppsCount: number;
  chat: React.ReactNode;
  /** Mensagens e erratas ainda não lidas por quem está logado. */
  chatCount: number;
}

type TabKey = "info" | "planilha" | "pps" | "chat";

export function JobTabs({
  info,
  planilha,
  pps,
  ppsCount,
  chat,
  chatCount,
}: Props) {
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
          active={tab === "planilha"}
          onClick={() => setTab("planilha")}
        >
          Planilha Interna
        </TabButton>
        <TabButton active={tab === "pps"} onClick={() => setTab("pps")}>
          Pedidos de Produção (PPs)
          {ppsCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {ppsCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
          Comunicação
          {chatCount > 0 && (
            <span className="ml-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
              {chatCount}
            </span>
          )}
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
        aria-hidden={tab !== "planilha"}
        className={cn(tab === "planilha" ? "" : "hidden")}
      >
        {planilha}
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
        aria-hidden={tab !== "chat"}
        className={cn(tab === "chat" ? "" : "hidden")}
      >
        {/* Só monta quando aberta: o chat marca a thread como lida ao
            montar, e montar escondido zeraria o badge sem ninguém ler. */}
        {tab === "chat" && chat}
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
