"use client";

/** O menu "Exibir colunas" e a alça de recolher da coluna Save.
 *
 *  Do design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
 *  `69342d83`), 26/08/2026.
 *
 *  ⚠️ Só a pastilha **Save** é clicável, e é assim no design: Orçado,
 *  Planejado e Realizado aparecem para dizer o que a planilha está
 *  mostrando, mas não têm liga/desliga — no mock eles são texto, não
 *  botão. Ligar os três de verdade mexe nas grades compartilhadas e em
 *  todos os `colSpan` das planilhas, e é entrega própria.
 */

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BlocoNoMenu {
  chave: string;
  rotulo: string;
  visivel: boolean;
  /** Sem isto o item é só leitura — mostra o estado e não reage. */
  onAlternar?: () => void;
}

export function MenuExibirColunas({ blocos }: { blocos: BlocoNoMenu[] }) {
  const [aberto, setAberto] = React.useState(false);
  const caixa = React.useRef<HTMLDivElement>(null);

  // Clique fora fecha: o menu é flutuante e não tem overlay próprio.
  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) {
        setAberto(false);
      }
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
      >
        <Columns3 className="h-3.5 w-3.5 text-muted-foreground" />
        Exibir
      </button>

      {aberto && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[238px] overflow-hidden rounded-xl border border-[#d7d5cf] bg-card text-left shadow-[0_14px_30px_-12px_rgba(0,0,0,.28)]">
          <p className="border-b border-border px-3 pb-1.5 pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            Exibir colunas
          </p>
          <div className="p-1.5">
            {blocos.map((b) => {
              const conteudo = (
                <>
                  <span
                    className={cn(
                      "flex h-[15px] w-[15px] flex-none items-center justify-center rounded",
                      b.visivel
                        ? "bg-foreground text-background"
                        : "border border-[#d7d5cf] bg-card",
                    )}
                  >
                    {b.visivel && <Check className="h-[11px] w-[11px]" />}
                  </span>
                  {b.rotulo}
                </>
              );
              const classes = cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] font-semibold",
                b.visivel ? "text-foreground" : "text-muted-foreground",
              );
              return b.onAlternar ? (
                <button
                  key={b.chave}
                  type="button"
                  onClick={b.onAlternar}
                  className={cn(classes, "hover:bg-muted")}
                >
                  {conteudo}
                </button>
              ) : (
                <div key={b.chave} className={classes}>
                  {conteudo}
                </div>
              );
            })}
            <p className="mx-1.5 mb-1 mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
              Cada bloco leva R$ Unit., QT, D/M e Total juntos.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** A alça colada na borda esquerda da planilha, para recolher e trazer de
 *  volta a coluna Save sem abrir o menu. */
export function AlcaDaColunaSave({
  visivel,
  onAlternar,
}: {
  visivel: boolean;
  onAlternar: () => void;
}) {
  const Icone = visivel ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onAlternar}
      title={visivel ? "Ocultar a coluna Save" : "Mostrar a coluna Save"}
      aria-label={visivel ? "Ocultar a coluna Save" : "Mostrar a coluna Save"}
      className="mt-10 flex h-[34px] w-[15px] flex-none items-center justify-center rounded-l-[7px] border border-r-0 border-[#dedcd7] bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icone className="h-3 w-3" />
    </button>
  );
}
