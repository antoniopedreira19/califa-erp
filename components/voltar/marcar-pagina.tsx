"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import type { MarcaDaPagina } from "@/lib/voltar";
import { marcarPagina } from "./estado";

/**
 * A página diz ao rastro do voltar quem ela é: o grupo da faixa do projeto
 * (para o voltar pular as abas irmãs) e o nome que aparece no balão
 * ("Voltar para JOB-0044 · Teste 1"). Decisão 108.
 *
 * A marca é por caminho, e não por entrada do rastro, porque o efeito do
 * filho roda antes do efeito do layout que registra a URL.
 */
export function useMarcarPagina({ grupo, rotulo }: MarcaDaPagina) {
  const caminho = usePathname();
  React.useEffect(() => {
    marcarPagina(caminho, { grupo, rotulo });
  }, [caminho, grupo, rotulo]);
}

/** Versão em componente, para página que é server component. */
export function MarcarPagina(props: { rotulo: string }) {
  useMarcarPagina({ rotulo: props.rotulo });
  return null;
}
