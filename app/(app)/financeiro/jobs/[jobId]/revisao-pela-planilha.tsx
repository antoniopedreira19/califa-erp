"use client";

/**
 * A revisão da abertura pelo "Editar planilha" do financeiro (opção C,
 * aprovada em 30/10/2026 — revisão das decisões 115 e 224).
 *
 * Com o job aberto, a alteração da planilha não ajusta mais sozinha a
 * previsão de recebimento nem os recolhimentos de imposto. A barra da
 * planilha leva o rascunho até a aba Abertura do Job ("Continuar para a
 * abertura"), sem gravar nada; a aba revisa as previsões sobre os números
 * novos, e o rodapé "Registrar alteração e revisão" — que fica embaixo de
 * todas as abas — abre o pop-up da planilha, que grava as duas juntas.
 *
 * As duas pontas moram em abas diferentes da mesma página: a seção da
 * planilha (`JobRealizadoSection`) e o formulário da abertura
 * (`AberturaForm`). Este contexto, dado pelas abas do job no financeiro, é
 * o que as liga. Fora delas é `null`, e as duas telas ficam como eram.
 */

import * as React from "react";
import type { NumerosDaAlteracao } from "@/app/(app)/jobs/[jobId]/realizado/actions-alteracao-financeiro";
import type { EdicaoRegistroAberturaInput } from "@/lib/validations/abertura-financeiro";
import type { TabKey } from "./abas";

/** O rascunho da planilha que a aba Abertura do Job está revisando. */
export interface RascunhoEmRevisao {
  /** Os números do job com o rascunho, pela conta do servidor. */
  numeros: NumerosDaAlteracao;
  linhas: number;
  campos: Array<{ rotulo: string; de: string; para: string }>;
  /** O rascunho mudou e os números estão sendo refeitos. */
  atualizando: boolean;
  /** A conta do servidor recusou o rascunho (a mensagem dele). */
  erro: string | null;
}

interface RevisaoPelaPlanilha {
  rascunho: RascunhoEmRevisao | null;
  definirRascunho: (r: RascunhoEmRevisao | null) => void;
  /** O rodapé "Registrar alteração e revisão" abre o pop-up da planilha
   *  com o registro da abertura. */
  registrar: (registro: EdicaoRegistroAberturaInput) => void;
  definirRegistrar: (fn: ((registro: EdicaoRegistroAberturaInput) => void) | null) => void;
  /** Onde o rodapé da revisão aparece: embaixo de todas as abas. */
  rodape: HTMLElement | null;
  abaAtual: TabKey;
  irPara: (aba: TabKey) => void;
}

const RevisaoPelaPlanilhaContext = React.createContext<RevisaoPelaPlanilha | null>(null);

/** A revisão pelo "Editar planilha", ou `null` fora das abas do job. */
export function useRevisaoPelaPlanilha() {
  return React.useContext(RevisaoPelaPlanilhaContext);
}

export function RevisaoPelaPlanilhaProvider({
  abaAtual,
  irPara,
  children,
}: {
  abaAtual: TabKey;
  irPara: (aba: TabKey) => void;
  children: (rodape: (el: HTMLDivElement | null) => void, ativa: boolean) => React.ReactNode;
}) {
  const [rascunho, setRascunho] = React.useState<RascunhoEmRevisao | null>(null);
  const [rodape, setRodape] = React.useState<HTMLElement | null>(null);
  // O registrar é da seção da planilha: guardado em ref, ele não refaz a
  // árvore a cada render dela.
  const registrarRef = React.useRef<((registro: EdicaoRegistroAberturaInput) => void) | null>(null);

  const valor = React.useMemo<RevisaoPelaPlanilha>(
    () => ({
      rascunho,
      definirRascunho: setRascunho,
      registrar: (registro) => registrarRef.current?.(registro),
      definirRegistrar: (fn) => {
        registrarRef.current = fn;
      },
      rodape,
      abaAtual,
      irPara,
    }),
    [rascunho, rodape, abaAtual, irPara],
  );

  return (
    <RevisaoPelaPlanilhaContext.Provider value={valor}>
      {children(setRodape, rascunho !== null)}
    </RevisaoPelaPlanilhaContext.Provider>
  );
}
