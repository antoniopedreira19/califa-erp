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

  React.useEffect(() => {
    iniciarRastro();
  }, []);

  React.useEffect(() => {
    registrarUrl(url);
  }, [url]);

  return null;
}
