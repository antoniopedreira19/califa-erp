"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { iniciarRastro, registrarUrl } from "./estado";

/**
 * Anota cada página por onde a pessoa passa, para o botão Voltar saber de
 * onde ela veio (decisão 108). Mora no layout do app, uma vez só, e não
 * desenha nada.
 *
 * Lê a query pelo `useSearchParams`, e por isso precisa de `<Suspense>` em
 * volta no layout. A troca de aba por `replaceState` (Next 14.1+) também
 * chega aqui, e atualiza a página atual em vez de somar uma nova.
 */
export function RastroDeNavegacao() {
  const caminho = usePathname();
  const query = useSearchParams().toString();
  const url = query ? `${caminho}?${query}` : caminho;

  // A página aberta dentro de um pop-up (o do Comitê de Aprovações,
  // decisão 223) divide o sessionStorage com a aba de fora: anotá-la
  // levaria o Voltar da aba para dentro do pop-up.
  const embutida = typeof window !== "undefined" && window.self !== window.top;

  React.useEffect(() => {
    if (embutida) return;
    iniciarRastro();
  }, [embutida]);

  React.useEffect(() => {
    if (embutida) return;
    registrarUrl(url);
  }, [url, embutida]);

  return null;
}
