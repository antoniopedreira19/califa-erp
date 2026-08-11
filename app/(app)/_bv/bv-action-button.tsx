"use client";

import * as React from "react";
import { Plus, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Largura da calha que recebe o botão.
 *
 *  "Adicionar BV" é o rótulo mais longo da trilha — mais que "Gerar PP" e
 *  "Ver PP" —, então é ele quem define a calha. Quem reserva o espaço na
 *  página (o `pr-` da seção) tem que usar este mesmo número, senão a
 *  trilha é cortada na borda direita. */
export const LARGURA_CALHA_BV = "w-[116px]";

/** Pílula do BV na calha da linha.
 *
 *  Desde que A e D só geram BV e B e C só geram PP, cada linha tem uma
 *  única ação — nunca as duas. Isso dispensou o antigo quadradinho de
 *  "+BV": o BV virou botão de texto na mesma calha, na mesma altura e com
 *  a mesma pílula de Gerar PP / Ver PP. Só o verbo e a cor mudam — criar é
 *  vermelho California, consultar é neutro.
 *
 *  "Abrir BV" usa o ícone de planilha (o BV é um documento interno) e
 *  "Ver PP" segue com o olho: ações parecidas, objetos diferentes. */
export const PILULA_BV =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50";

export function BvActionButton({
  temBv,
  itemNome,
  somenteLeitura,
  onClick,
}: {
  temBv: boolean;
  itemNome: string;
  /** BV já enviado ao financeiro (ou tela congelada): abre em consulta.
   *  O rótulo não muda — "Abrir BV" já cobre ver e editar. */
  somenteLeitura?: boolean;
  onClick: () => void;
}) {
  const title = temBv
    ? somenteLeitura
      ? `Ver BV de ${itemNome}`
      : `Editar BV de ${itemNome}`
    : `Lançar BV em ${itemNome}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        PILULA_BV,
        temBv
          ? "border-border bg-white text-foreground hover:border-[#d7d7d7] hover:bg-muted"
          : "border-border bg-white text-california-red hover:border-california-red/30 hover:bg-california-red/[0.06]",
      )}
    >
      {temBv ? (
        <>
          <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
          Abrir BV
        </>
      ) : (
        <>
          <Plus className="h-3.5 w-3.5" />
          Adicionar BV
        </>
      )}
    </button>
  );
}
