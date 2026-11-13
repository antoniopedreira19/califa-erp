"use client";

import * as React from "react";
import { buscarFornecedoresParaEscolha } from "./actions";
import type { FornecedorDaBusca } from "@/lib/data/fornecedores-busca";

/**
 * A busca de fornecedor dos combos (decisão 255, 12/11/2026).
 *
 * A tela manda só os fornecedores que já aparecem nela; o combo busca o
 * resto no servidor enquanto a pessoa digita. Este hook guarda o que as
 * buscas trouxeram (`achados`), para a tela juntar à própria lista e achar
 * o escolhido pelo id — o nome na revisão da PP, o documento na NF, o lápis.
 *
 * `buscar` é estável: pode ir direto para o `Combobox`.
 */
export function useBuscaDeFornecedores(): {
  achados: ReadonlyArray<FornecedorDaBusca>;
  buscar: (termo: string) => Promise<FornecedorDaBusca[]>;
} {
  const [achados, setAchados] = React.useState<ReadonlyArray<FornecedorDaBusca>>([]);
  const buscar = React.useCallback(async (termo: string) => {
    const res = await buscarFornecedoresParaEscolha(termo);
    if (!res.ok) return [];
    setAchados((antes) => {
      const ids = new Set(antes.map((f) => f.id));
      const novos = res.fornecedores.filter((f) => !ids.has(f.id));
      return novos.length === 0 ? antes : [...antes, ...novos];
    });
    return res.fornecedores;
  }, []);
  return { achados, buscar };
}

/** A lista da tela com o que a busca achou, sem repetir (a da tela vence). */
export function juntarFornecedores<F extends { id: string }>(
  daTela: ReadonlyArray<F>,
  achados: ReadonlyArray<F>,
): F[] {
  if (achados.length === 0) return [...daTela];
  const ids = new Set(daTela.map((f) => f.id));
  return [...daTela, ...achados.filter((f) => !ids.has(f.id))];
}
