"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabKey = "abertura" | "info" | "planilha" | "fluxo" | "chat";

interface Props {
  abertura: React.ReactNode;
  info: React.ReactNode;
  planilha: React.ReactNode;
  fluxo: React.ReactNode;
  chat: React.ReactNode;
  /** Mensagens e erratas ainda não lidas por quem está logado. */
  chatCount: number;
  abaInicial?: TabKey;
}

/**
 * As cinco abas do job aberto no financeiro, como no protótipo "Abertura
 * de Job — Financeiro".
 *
 * Três delas — Informações, Planilha Interna e Comunicação — são os
 * MESMOS componentes da página de Jobs, alimentados pelo mesmo
 * carregamento (`app/(app)/jobs/[jobId]/carregar-detalhe.ts`). O
 * financeiro e a produção olham o mesmo job; ter duas planilhas para
 * manter era o risco que a decisão anterior evitava, e reusar resolve
 * sem reabrir esse risco.
 *
 * As duas próprias são "Abertura do Job" (o registro que o financeiro
 * confirmou, com o botão de editar) e "Fluxo de Caixa do Job".
 *
 * Casca separada da `JobTabs` de Jobs de propósito: as abas são outras, a
 * ordem é outra, e ali existe a de PPs com o FAB do chat, que aqui não
 * entra. Unificar as duas custaria mais props condicionais do que as ~40
 * linhas que a duplicação da casca custa.
 */
export function JobFinanceiroTabs({
  abertura,
  info,
  planilha,
  fluxo,
  chat,
  chatCount,
  abaInicial = "abertura",
}: Props) {
  const [tab, setTab] = React.useState<TabKey>(abaInicial);

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções do job no financeiro"
        className="flex items-center gap-1 overflow-x-auto border-b border-border"
      >
        <TabButton active={tab === "abertura"} onClick={() => setTab("abertura")}>
          Abertura do Job
        </TabButton>
        <TabButton active={tab === "info"} onClick={() => setTab("info")}>
          Informações do Job
        </TabButton>
        <TabButton active={tab === "planilha"} onClick={() => setTab("planilha")}>
          Planilha Interna
        </TabButton>
        <TabButton active={tab === "fluxo"} onClick={() => setTab("fluxo")}>
          Fluxo de Caixa do Job
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
        aria-hidden={tab !== "abertura"}
        className={cn(tab === "abertura" ? "" : "hidden")}
      >
        {abertura}
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
        aria-hidden={tab !== "fluxo"}
        className={cn(tab === "fluxo" ? "" : "hidden")}
      >
        {fluxo}
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
