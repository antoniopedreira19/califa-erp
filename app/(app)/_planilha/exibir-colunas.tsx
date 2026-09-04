"use client";

/** O menu "Exibir colunas" e a alça de recolher da coluna Save.
 *
 *  Do design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
 *  `69342d83`), 26/08/2026.
 *
 *  Item COM `onAlternar` é botão e liga/desliga o bloco; item sem ele é
 *  texto — mostra o estado e explica no `title` por que não reage. No
 *  design original só a pastilha Save era clicável; desde 03/09/2026 a
 *  planilha da versão liga e desliga Orçado e Rentabilidade de verdade
 *  (só o Planejado ficou fixo), e por isso o liga/desliga passou a ser a
 *  regra em vez da exceção.
 *
 *  ⚠️ Quem lista os blocos é a TELA, porque as grades não são a mesma:
 *  a planilha do orçamento (`grade-orcamento`) fecha em Orçado ·
 *  Planejado · Rentabilidade, e a do job (`grade-job`) em Orçado ·
 *  Planejado · Realizado. Orçamento não tem realizado — ele nasce da PP,
 *  depois da abertura do job. As planilhas de job seguem com os blocos em
 *  só leitura: lá a grade é outra, e o colSpan dela é entrega própria.
 */

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SAVE } from "./blocos";

export interface BlocoNoMenu {
  chave: string;
  rotulo: string;
  visivel: boolean;
  /** Sem isto o item é só leitura — mostra o estado e não reage. */
  onAlternar?: () => void;
  /** Por que este item não reage. Vira o `title` do item só leitura, para
   *  quem clicar nele saber que não foi um defeito. */
  dica?: string;
}

/** Uma seção a mais no menu, abaixo da lista principal — no job é a de
 *  "Rentabilidade", com as duas colunas que entram dentro dos blocos. */
export interface SecaoDoMenu {
  titulo: string;
  itens: BlocoNoMenu[];
  /** Explicação curta no pé da seção. */
  dica?: string;
}

export function MenuExibirColunas({
  blocos,
  titulo = "Exibir colunas",
  dica = "Cada bloco leva R$ Unit., QT, D/M e Total juntos.",
  secoes,
}: {
  blocos: BlocoNoMenu[];
  /** Cabeçalho da lista principal. Com seções, o design escreve só
   *  "Colunas" — o resto do menu já diz o que cada parte exibe. */
  titulo?: string;
  dica?: string;
  secoes?: SecaoDoMenu[];
}) {
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
        <div
          className={cn(
            "absolute right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-[#d7d5cf] bg-card text-left shadow-[0_14px_30px_-12px_rgba(0,0,0,.28)]",
            // Com seções os rótulos são mais longos ("Rentabilidade
            // planejada") — o menu abre mais largo, como no design.
            secoes ? "w-[300px]" : "w-[238px]",
          )}
        >
          <p className="border-b border-border px-3 pb-1.5 pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            {titulo}
          </p>
          <div className="p-1.5">
            {blocos.map(itemDoMenu)}
            <p className="mx-1.5 mb-1 mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {dica}
            </p>
          </div>
          {secoes?.map((secao) => (
            <React.Fragment key={secao.titulo}>
              <p className="border-y border-border px-3 pb-1.5 pt-2 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                {secao.titulo}
              </p>
              <div className="p-1.5">
                {secao.itens.map(itemDoMenu)}
                {secao.dica && (
                  <p className="mx-1.5 mb-1 mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                    {secao.dica}
                  </p>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Um item do menu: botão quando liga/desliga, texto quando só mostra. */
function itemDoMenu(b: BlocoNoMenu) {
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
    <div key={b.chave} className={cn(classes, "cursor-default")} title={b.dica}>
      {conteudo}
    </div>
  );
}

/** A alça colada na borda esquerda da planilha, para recolher e trazer de
 *  volta a coluna Save sem abrir o menu.
 *
 *  O chevron aponta para o DESTINO do clique, não para o estado atual:
 *  com a coluna aberta ele aponta para a direita (é para lá que ela vai
 *  sumir) e, recolhida, para a esquerda (é de lá que ela volta). Estava
 *  invertido, e a alça recolhida ainda vinha sem o rótulo — corrigido
 *  contra o design em 31/08/2026. */
export function AlcaDaColunaSave({
  visivel,
  onAlternar,
}: {
  visivel: boolean;
  onAlternar: () => void;
}) {
  const Icone = visivel ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onAlternar}
      title={visivel ? "Ocultar a coluna Save" : "Mostrar a coluna Save"}
      aria-label={visivel ? "Ocultar a coluna Save" : "Mostrar a coluna Save"}
      className={cn(
        "flex flex-none transition-colors hover:brightness-95",
        visivel ? SAVE.alca : SAVE.alcaRecolhida,
      )}
    >
      <Icone className="h-[11px] w-[11px]" />
      {/* O rótulo só existe recolhido: aberto, quem nomeia a coluna é o
          sub-cabeçalho dela dentro da tabela. */}
      {!visivel && (
        <span className={SAVE.alcaRotulo} aria-hidden>
          <span>S</span>
          <span>A</span>
          <span>V</span>
          <span>E</span>
        </span>
      )}
    </button>
  );
}
