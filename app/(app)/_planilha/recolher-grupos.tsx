"use client";

/** Recolher e expandir os agrupamentos de uma planilha.
 *
 *  A planilha do orçamento tinha isso desde sempre; a do job, a da
 *  conferência do financeiro e os blocos da visão agregada, não. Em vez
 *  de copiar o `Set` de fechados para cada uma — quatro cópias da mesma
 *  máquina de estado, que divergem na primeira correção —, a lógica mora
 *  aqui e as telas só a consomem.
 *
 *  **Guarda quem está FECHADO**, e não quem está aberto: grupo novo nasce
 *  aberto sem precisar de sincronização quando a lista de grupos muda.
 *  Sem persistência — recarregar a página volta tudo a aberto.
 *
 *  Exceção deliberada: os blocos de job da visão agregada nascem
 *  FECHADOS, porque lá a página inteira é uma lista de jobs e abrir todos
 *  de uma vez enterraria o consolidado. Quem decide isso é o `padrao`.
 */

import * as React from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

export interface ControleDeGrupos {
  /** O grupo está expandido? */
  estaAberto: (id: string) => boolean;
  /** Alterna UM grupo. */
  alternar: (id: string) => void;
  /** Alterna TODOS de uma vez — é o que o botão usa. */
  alternarTodos: () => void;
  /** Estado misto resolve para "recolher": basta um aberto para o botão
   *  oferecer fechar tudo. */
  algumAberto: boolean;
}

export function useGruposRecolhiveis(
  ids: readonly string[],
  padrao: "aberto" | "fechado" = "aberto",
): ControleDeGrupos {
  const [alternados, setAlternados] = React.useState<Set<string>>(new Set());

  const estaAberto = React.useCallback(
    (id: string) =>
      padrao === "aberto" ? !alternados.has(id) : alternados.has(id),
    [alternados, padrao],
  );

  const alternar = React.useCallback((id: string) => {
    setAlternados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const algumAberto = ids.some((id) => estaAberto(id));

  const alternarTodos = React.useCallback(() => {
    // Fechar tudo = marcar todos como alternados no padrão "aberto", e
    // limpar o conjunto no padrão "fechado". Abrir tudo é o inverso.
    const fecharTudo = algumAberto;
    const marcarTodos = padrao === "aberto" ? fecharTudo : !fecharTudo;
    setAlternados(marcarTodos ? new Set(ids) : new Set());
  }, [algumAberto, ids, padrao]);

  return { estaAberto, alternar, alternarTodos, algumAberto };
}

/** O botão que alterna a planilha inteira. O rótulo segue o estado: com
 *  algum grupo aberto ele oferece recolher; com todos fechados, expandir. */
export function BotaoRecolherTodos({
  algumAberto,
  onAlternarTodos,
  className,
}: {
  algumAberto: boolean;
  onAlternarTodos: () => void;
  className?: string;
}) {
  const Icone = algumAberto ? ChevronsDownUp : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={onAlternarTodos}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
      }
    >
      <Icone className="h-3.5 w-3.5" />
      {algumAberto ? "Recolher todos" : "Expandir todos"}
    </button>
  );
}
