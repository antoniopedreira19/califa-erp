"use client";

/** Onde fica a barra da planilha do mês ("Save", "Histórico", "Exibir") no
 *  orçamento mensal — Fee e Always On (decisão 219, revista em 30/10/2026).
 *
 *  A barra é da `GruposSection` — é lá que moram os estados que ela liga e
 *  desliga —, mas o lugar dela é de quem desenha a linha do mês: na tela de
 *  um mês só, a própria linha do título ("Outubro de 2026", à direita); na
 *  vista Total, acima da linha de cada mês aberto (o `TrimestreEmpilhado`).
 *  Esse lugar chega à planilha por contexto e a barra vai para lá por
 *  portal. Sem o contexto (a planilha nacional), a barra fica onde sempre
 *  esteve, entre o título e a tabela.
 *
 *  No mensal o "Recolher grupos" sai da barra e vai para a célula vazia do
 *  cabeçalho da tabela, acima de "Grupo · Item": com ele na barra, a vista
 *  Total mostrava dois "Recolher todos" seguidos, o dos meses e o dos
 *  grupos (Tiago, 30/10/2026). */

import * as React from "react";
import { createPortal } from "react-dom";

const LugarDaBarra = React.createContext<HTMLElement | null>(null);

export function ComLugarDaBarra({
  lugar,
  children,
}: {
  lugar: HTMLElement | null;
  children: React.ReactNode;
}) {
  return <LugarDaBarra.Provider value={lugar}>{children}</LugarDaBarra.Provider>;
}

/** A barra: no lugar que a linha do mês reservou, quando há um; senão,
 *  aqui mesmo, com a margem de baixo que a separa da planilha. */
export function BarraDaPlanilha({ children }: { children: React.ReactNode }) {
  const lugar = React.useContext(LugarDaBarra);
  if (!lugar) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3">{children}</div>
    );
  }
  return createPortal(
    <div className="flex items-center justify-between gap-3">{children}</div>,
    lugar,
  );
}

/** A linha do título da tela de um mês só, com o lugar da barra à direita,
 *  antes das `acoes` ("Copiar itens de outro mês"). A planilha do mês vem
 *  em `children` e manda a barra para cá. */
export function TituloComABarra({
  titulo,
  acoes,
  children,
}: {
  titulo: React.ReactNode;
  acoes?: React.ReactNode;
  children: React.ReactNode;
}) {
  // O `set` do useState é estável: serve de ref sem disparar o laço que
  // uma ref nova a cada render provocaria.
  const [lugar, setLugar] = React.useState<HTMLElement | null>(null);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {titulo}
        <div className="flex flex-wrap items-center gap-3">
          <div ref={setLugar} />
          {acoes}
        </div>
      </div>
      <ComLugarDaBarra lugar={lugar}>{children}</ComLugarDaBarra>
    </>
  );
}

const RecolherNoCabecalho = React.createContext(false);

/** O "Recolher grupos" na célula do cabeçalho da tabela, e não na barra. */
export function ComRecolherNoCabecalho({ children }: { children: React.ReactNode }) {
  return <RecolherNoCabecalho.Provider value>{children}</RecolherNoCabecalho.Provider>;
}

export function useRecolherNoCabecalho(): boolean {
  return React.useContext(RecolherNoCabecalho);
}

const PlanilhaColada = React.createContext(false);

/** A planilha encosta na linha do mês, logo acima dela: as duas viram um
 *  card só (vista Total do orçamento mensal). */
export function ComPlanilhaColada({ children }: { children: React.ReactNode }) {
  return <PlanilhaColada.Provider value>{children}</PlanilhaColada.Provider>;
}

export function usePlanilhaColada(): boolean {
  return React.useContext(PlanilhaColada);
}
