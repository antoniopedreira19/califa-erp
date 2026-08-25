"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Cinco abas (25/08/2026, simplificação).
 *
 * - PPs: pedidos de produção (aprovação/rejeição).
 * - Pedidos de Desembolsos: desembolsos diretos (aprovação/rejeição/cancelamento).
 * - Recorrências: gestão de contas avulsas recorrentes.
 * - Títulos a Pagar: avulsos + PPs + desembolsos NÃO cartão (a pagar e pagos,
 *   com filtro interno de status padrão "A pagar").
 * - Cartão: mesma coisa para cartão de crédito, com baixa em lote da fatura.
 *
 * A antiga "Títulos Pagos" foi absorvida pelo filtro de status interno de
 * "Títulos a Pagar" e "Cartão". A antiga "Lançamentos Avulsos" já havia
 * sido absorvida por "Títulos a Pagar" como origem AVULSO.
 */
interface Props {
  /** Conteúdo da aba de PPs (já pronto, vindo da page.tsx). */
  pps: React.ReactNode;
  /** Contagem de PPs em avaliação — vira badge. */
  ppsPendentesCount: number;
  /** Conteúdo da aba de desembolsos (já pronto, vindo da page.tsx). */
  desembolsos: React.ReactNode;
  /** Contagem de desembolsos em avaliação — vira badge. */
  desembolsosPendentesCount: number;
  /** Conteúdo da aba unificada de títulos a pagar (não cartão, todos os status). */
  titulos: React.ReactNode;
  /** Quantos títulos "a pagar" não-cartão existem — vira badge. */
  titulosAPagarCount: number;
  /** Conteúdo da aba de recorrências. */
  recorrentes: React.ReactNode;
  /** Contagem de recorrências ativas — vira badge. */
  recorrentesAtivasCount: number;
  /** Conteúdo da aba de títulos no cartão (todos os status). */
  titulosCartao: React.ReactNode;
  /** Quantos títulos de cartão estão a pagar — vira badge. */
  titulosCartaoCount: number;
}

type TabKey = "pps" | "desembolsos" | "titulos" | "cartao" | "recorrentes";

export function ContasPagarTabs({
  pps,
  ppsPendentesCount,
  desembolsos,
  desembolsosPendentesCount,
  titulos,
  titulosAPagarCount,
  recorrentes,
  recorrentesAtivasCount,
  titulosCartao,
  titulosCartaoCount,
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
          active={tab === "desembolsos"}
          onClick={() => setTab("desembolsos")}
          count={desembolsosPendentesCount}
        >
          Pedidos de Desembolsos
        </TabButton>
        <TabButton
          active={tab === "recorrentes"}
          onClick={() => setTab("recorrentes")}
          count={recorrentesAtivasCount}
        >
          Recorrências
        </TabButton>
        <TabButton
          active={tab === "titulos"}
          onClick={() => setTab("titulos")}
          count={titulosAPagarCount}
        >
          Títulos a Pagar
        </TabButton>
        <TabButton
          active={tab === "cartao"}
          onClick={() => setTab("cartao")}
          count={titulosCartaoCount}
        >
          Cartão
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
        aria-hidden={tab !== "desembolsos"}
        className={cn(tab === "desembolsos" ? "" : "hidden")}
      >
        {desembolsos}
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
      <div
        role="tabpanel"
        aria-hidden={tab !== "cartao"}
        className={cn(tab === "cartao" ? "" : "hidden")}
      >
        {titulosCartao}
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
  count?: number;
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
      {count !== undefined && count > 0 && (
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
