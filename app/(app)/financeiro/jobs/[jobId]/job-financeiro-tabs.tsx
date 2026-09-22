"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

import { abaDaUrl, type TabKey } from "./abas";

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

  // Um link para a MESMA página com outro `?aba=` (o "Visualizar planilha
  // interna" do formulário da abertura e o "Voltar para a aprovação" da
  // planilha em destaque — decisão 099) é navegação suave: o componente
  // não remonta e o `useState` guardaria a aba velha. A aba pedida pela
  // URL, quando muda, manda.
  //
  // A chave é a URL do navegador, e não a prop que o servidor calcula: o
  // clique numa aba grava o `?aba=` (abaixo) sem passar pelo servidor, e a
  // prop ficaria parada na aba da última renderização. Com a prop, um link
  // de volta para essa mesma aba não mudaria nada, e a tela ficaria na aba
  // clicada (achado da revisão de 22/09/2026).
  const abaNaUrl = abaDaUrl(useSearchParams().get("aba") ?? undefined);
  React.useEffect(() => {
    setTab(abaNaUrl ?? abaInicial);
  }, [abaNaUrl, abaInicial]);

  /**
   * Troca de aba e grava a escolha no `?aba=`, sem passar pelo router — a
   * página é `force-dynamic`, e um `router.replace` refaria todas as
   * consultas só para trocar de aba. O mesmo de `abertura-tabs.tsx`: o
   * link continua copiável, e os outros parâmetros (`aprovarSave`, `mes`)
   * ficam como estão.
   */
  function irPara(nova: TabKey) {
    setTab(nova);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("aba", nova);
      window.history.replaceState(null, "", url.toString());
    }
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções do job no financeiro"
        className="flex items-center gap-1 overflow-x-auto border-b border-border"
      >
        <TabButton active={tab === "abertura"} onClick={() => irPara("abertura")}>
          Abertura do Job
        </TabButton>
        <TabButton active={tab === "info"} onClick={() => irPara("info")}>
          Informações do Job
        </TabButton>
        <TabButton active={tab === "planilha"} onClick={() => irPara("planilha")}>
          Planilha Interna
        </TabButton>
        <TabButton active={tab === "fluxo"} onClick={() => irPara("fluxo")}>
          Fluxo de Caixa do Job
        </TabButton>
        <TabButton active={tab === "chat"} onClick={() => irPara("chat")}>
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
