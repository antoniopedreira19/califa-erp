"use client";

import * as React from "react";
import type { ModoRentabilidade } from "@/lib/relatorios/rentabilidade";

/**
 * Contexto do toggle Previsto | Realizado.
 *
 * Motivação (P7 do diagnóstico de perf): trocar o modo NÃO altera nada
 * que o servidor precise recalcular — a view devolve os dois lados
 * (`_previsto` e `_realizado`) por job, e o `page.tsx` já pré-agrega
 * grupos e totais dos dois modos. Trocar o modo é então puramente uma
 * escolha visual do cliente.
 *
 * Antes, o modo vinha na query string e mudava via `router.push`, o que
 * forçava re-render de todo o Server Component (~1s a cada click). Agora
 * mora em estado local do provider e sincroniza a URL via
 * `history.replaceState` — o link continua compartilhável, mas a troca é
 * instantânea.
 */
interface ModoCtx {
  modo: ModoRentabilidade;
  setModo: (m: ModoRentabilidade) => void;
}

const Ctx = React.createContext<ModoCtx | null>(null);

export function ModoProvider({
  modoInicial,
  children,
}: {
  modoInicial: ModoRentabilidade;
  children: React.ReactNode;
}) {
  const [modo, setModoState] = React.useState<ModoRentabilidade>(modoInicial);

  const setModo = React.useCallback((novo: ModoRentabilidade) => {
    setModoState(novo);
    // Sincroniza a URL sem disparar navegação. Se o usuário compartilhar
    // o link ou dar F5, o estado inicial já respeita o modo escolhido.
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (novo === "previsto") url.searchParams.delete("modo");
    else url.searchParams.set("modo", novo);
    window.history.replaceState({}, "", url.toString());
  }, []);

  return <Ctx.Provider value={{ modo, setModo }}>{children}</Ctx.Provider>;
}

export function useModo(): ModoCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error("useModo() precisa estar dentro de <ModoProvider>");
  }
  return ctx;
}
