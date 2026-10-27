"use client";

/** A barra da planilha do mês ("Recolher todos", "Save", "Exibir") ACIMA
 *  da linha do mês na vista Total do orçamento mensal, e não entre a linha
 *  e a planilha (Tiago, 27/10/2026).
 *
 *  A barra é da `GruposSection` — é lá que moram os estados que ela liga e
 *  desliga —, mas a linha do mês é do `TrimestreEmpilhado`. Ele põe um
 *  lugar vazio acima da linha de cada mês aberto e o entrega por contexto à
 *  planilha daquele mês; a barra vai para lá por portal. Sem o contexto
 *  (a tela de um mês só, a planilha nacional), a barra fica onde sempre
 *  esteve. */

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

/** A barra: no lugar acima da linha do mês, quando há um; senão, aqui
 *  mesmo, com a margem de baixo que a separa da planilha. */
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
