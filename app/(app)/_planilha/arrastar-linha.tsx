"use client";

/** Arrastar a linha de item para outro lugar da planilha — decisão 104.
 *
 *  A alça mora no recuo de 30px que já separa o item do agrupamento: não
 *  cria coluna, não mexe na grade e só aparece no hover da linha. O gesto
 *  começa nela e em nenhum outro lugar, para arrastar não brigar com
 *  clicar na célula, selecionar e abrir o Tipo.
 *
 *  Durante o arrasto NADA passa pelo estado do React: a linha de inserção,
 *  o fantasma que segue o cursor e o realce do agrupamento recolhido são
 *  mexidos direto no DOM. A planilha tem centenas de células, e um
 *  `setState` por movimento do mouse a redesenharia inteira a cada pixel.
 *  O React só fica sabendo no começo (qual linha apagar) e no fim (onde
 *  soltou).
 *
 *  O contrato com a tabela são três atributos:
 *    - `data-arrasto-item` + `data-arrasto-grupo` em cada `<tr>` de item;
 *    - `data-arrasto-cab` + `data-arrasto-qtd` + `data-arrasto-nome` na
 *      linha do agrupamento;
 *    - `data-arrasto-inicio` na célula onde a linha de inserção começa.
 *  A área de um agrupamento vai da linha dele até a do próximo — o
 *  "Novo item" entra na área do grupo de cima, que é onde ele aparece.
 */

import * as React from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AlvoDoArrasto {
  grupoId: string;
  /** Posição entre os itens do grupo de destino SEM o item arrastado. */
  indice: number;
}

/** O alvo mais o que o fantasma precisa dizer sobre ele. */
interface AlvoNaTela extends AlvoDoArrasto {
  nomeDoGrupo: string;
  /** Grupo recolhido ou vazio: o item vai para o fim dele. */
  noFim: boolean;
}

interface ItemArrastado {
  id: string;
  grupoId: string;
  /** Nome do item, no fantasma. */
  rotulo: string;
  /** Sigla do tipo de custo (B, A, AR…), no fantasma. */
  tipo: string;
  /** Texto miúdo à direita do nome (o total orçado). */
  detalhe: string;
}

/** Quanto o cursor anda antes de virar arrasto — abaixo disso é clique. */
const LIMIAR_PX = 4;
/** Faixa perto da borda da janela em que a página rola sozinha. A de
 *  baixo é maior porque a barra fixa de aprovação cobre o pé da tela. */
const BORDA_TOPO_PX = 60;
const BORDA_BASE_PX = 110;

/** Realce do agrupamento recolhido (ou vazio) que vai receber o item.
 *  Vai na `<tr>` do grupo e é ligado pelo atributo, fora do React.
 *
 *  Uma variante só, com o atributo DENTRO do seletor: empilhar
 *  `data-[…]:[&>td]:` no Tailwind 3 monta o seletor ao contrário (o
 *  atributo vai para o `<td>`) e o realce nunca acende. */
export const REALCE_ALVO_DO_ARRASTO =
  "[&[data-arrasto-alvo]>td]:shadow-[inset_0_2px_0_#E74B56,inset_0_-2px_0_#E74B56]";

export function useArrastoDeLinhas({
  container,
  onSoltar,
  onClicar,
}: {
  /** O card da planilha — `relative`, é nele que a linha se posiciona. */
  container: React.RefObject<HTMLElement>;
  onSoltar: (itemId: string, alvo: AlvoDoArrasto) => void;
  /** Soltou sem arrastar: o clique na alça seleciona a linha. */
  onClicar: (itemId: string) => void;
}) {
  const linhaRef = React.useRef<HTMLDivElement>(null);
  const [arrastando, setArrastando] = React.useState<string | null>(null);

  // As callbacks mudam a cada render da tabela; o gesto lê a última.
  const aoSoltar = React.useRef(onSoltar);
  aoSoltar.current = onSoltar;
  const aoClicar = React.useRef(onClicar);
  aoClicar.current = onClicar;

  const iniciar = React.useCallback(
    (evento: React.PointerEvent, item: ItemArrastado) => {
      if (evento.button !== 0) return;
      const raiz = container.current;
      const linha = linhaRef.current;
      if (!raiz || !linha) return;
      // Sem isto o botão ganha o foco e o card perde as setas.
      evento.preventDefault();
      evento.stopPropagation();

      const x0 = evento.clientX;
      const y0 = evento.clientY;
      let ux = x0;
      let uy = y0;
      let ativo = false;
      let alvo: AlvoNaTela | null = null;
      let aviso: HTMLSpanElement | null = null;
      let quadro = 0;
      let fantasma: HTMLDivElement | null = null;
      let realcado: HTMLElement | null = null;
      const cursorAntes = document.body.style.cursor;
      const selecaoAntes = document.body.style.userSelect;

      function realcar(el: HTMLElement | null) {
        if (realcado === el) return;
        realcado?.removeAttribute("data-arrasto-alvo");
        el?.setAttribute("data-arrasto-alvo", "");
        realcado = el;
      }

      function calcular(): AlvoNaTela | null {
        const cabs = Array.from(
          raiz!.querySelectorAll<HTMLElement>("[data-arrasto-cab]"),
        );
        if (cabs.length === 0) return null;
        let k = 0;
        cabs.forEach((c, i) => {
          if (c.getBoundingClientRect().top <= uy) k = i;
        });
        const cab = cabs[k];
        const grupoId = cab.dataset.arrastoCab!;
        const nomeDoGrupo = cab.dataset.arrastoNome ?? "";
        const linhas = Array.from(
          raiz!.querySelectorAll<HTMLElement>(
            `[data-arrasto-item][data-arrasto-grupo="${grupoId}"]`,
          ),
        ).filter((el) => el.dataset.arrastoItem !== item.id);

        // Grupo recolhido ou vazio: não há linha entre as quais cair. O
        // item vai para o fim dele, e é a linha do grupo que acende.
        if (linhas.length === 0) {
          const qtd = Number(cab.dataset.arrastoQtd ?? 0);
          const semOItem = item.grupoId === grupoId ? Math.max(0, qtd - 1) : qtd;
          linha!.hidden = true;
          realcar(cab);
          return { grupoId, indice: semOItem, nomeDoGrupo, noFim: true };
        }

        realcar(null);
        const indice = linhas.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top + r.height / 2 < uy;
        }).length;
        const ref =
          indice === 0
            ? linhas[0].getBoundingClientRect().top
            : linhas[indice - 1].getBoundingClientRect().bottom;
        const caixa = raiz!.getBoundingClientRect();
        const inicio = raiz!
          .querySelector<HTMLElement>("[data-arrasto-inicio]")
          ?.getBoundingClientRect().left;
        const esquerda = (inicio ?? caixa.left) - caixa.left + 8;
        linha!.hidden = false;
        linha!.style.top = `${ref - caixa.top - 1}px`;
        linha!.style.left = `${esquerda}px`;
        linha!.style.width = `${Math.max(0, caixa.width - esquerda)}px`;
        return { grupoId, indice, nomeDoGrupo, noFim: false };
      }

      /** Embaixo do fantasma: para onde o item vai quando sai do grupo
       *  dele, ou que vai para o fim de um grupo recolhido. Dentro do
       *  próprio grupo a linha vermelha já diz tudo. */
      function avisar() {
        if (!aviso) return;
        let texto = "";
        if (alvo?.noFim) texto = `Solte para ir ao fim de ${alvo.nomeDoGrupo}`;
        else if (alvo && alvo.grupoId !== item.grupoId) {
          texto = `Vai para ${alvo.nomeDoGrupo} · ${alvo.indice + 1}º`;
        }
        aviso.textContent = texto;
        aviso.hidden = texto === "";
      }

      function posicionarFantasma() {
        if (fantasma) {
          fantasma.style.transform = `translate(${ux + 14}px, ${uy - 16}px)`;
        }
      }

      function comecar() {
        ativo = true;
        setArrastando(item.id);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        fantasma = document.createElement("div");
        fantasma.className =
          "pointer-events-none fixed left-0 top-0 z-[70] flex flex-col items-start gap-1";
        const corpo = document.createElement("div");
        corpo.className =
          "flex h-8 min-w-[240px] max-w-[360px] -rotate-1 items-center gap-2.5 rounded-lg border border-california-red bg-white pl-2 pr-3 text-xs shadow-elevated";
        const grip = document.createElement("span");
        grip.className = "text-muted-foreground";
        grip.textContent = "⋮⋮";
        const nome = document.createElement("span");
        nome.className = "min-w-0 flex-1 truncate font-semibold text-foreground";
        nome.textContent = item.rotulo;
        const tipo = document.createElement("span");
        tipo.className =
          "rounded-md border border-border bg-white px-1.5 text-[10.5px] font-bold text-foreground";
        tipo.textContent = item.tipo;
        const detalhe = document.createElement("span");
        detalhe.className = "whitespace-nowrap font-mono text-[11.5px] font-semibold text-[#1e4fa3]";
        detalhe.textContent = item.detalhe;
        corpo.append(grip, nome, tipo, detalhe);
        aviso = document.createElement("span");
        aviso.className =
          "rounded-md bg-california-dark px-2 py-0.5 text-[11px] font-semibold text-white";
        aviso.hidden = true;
        fantasma.append(corpo, aviso);
        document.body.appendChild(fantasma);
        posicionarFantasma();
        rolar();
      }

      // A página rola sozinha quando o cursor encosta na borda: é o que
      // leva um item do topo para o fim de um orçamento longo.
      function rolar() {
        if (!ativo) return;
        let passo = 0;
        if (uy < BORDA_TOPO_PX) passo = -Math.ceil((BORDA_TOPO_PX - uy) / 4);
        else if (uy > window.innerHeight - BORDA_BASE_PX) {
          passo = Math.ceil((uy - (window.innerHeight - BORDA_BASE_PX)) / 4);
        }
        if (passo !== 0) {
          window.scrollBy(0, passo);
          alvo = calcular();
          avisar();
        }
        quadro = requestAnimationFrame(rolar);
      }

      function mover(e: PointerEvent) {
        ux = e.clientX;
        uy = e.clientY;
        if (!ativo) {
          if (Math.hypot(ux - x0, uy - y0) < LIMIAR_PX) return;
          comecar();
        }
        posicionarFantasma();
        alvo = calcular();
        avisar();
      }

      function encerrar(aplicar: boolean) {
        document.removeEventListener("pointermove", mover);
        document.removeEventListener("pointerup", soltar);
        document.removeEventListener("pointercancel", cancelar);
        document.removeEventListener("keydown", tecla, true);
        cancelAnimationFrame(quadro);
        fantasma?.remove();
        realcar(null);
        linha!.hidden = true;
        document.body.style.cursor = cursorAntes;
        document.body.style.userSelect = selecaoAntes;
        const foiArrasto = ativo;
        ativo = false;
        setArrastando(null);
        if (!foiArrasto) {
          if (aplicar) aoClicar.current(item.id);
          return;
        }
        if (aplicar && alvo) {
          aoSoltar.current(item.id, { grupoId: alvo.grupoId, indice: alvo.indice });
        }
      }
      function soltar() {
        encerrar(true);
      }
      function cancelar() {
        encerrar(false);
      }
      // Esc desiste do arrasto e não chega à seleção da planilha.
      function tecla(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        encerrar(false);
      }

      document.addEventListener("pointermove", mover);
      document.addEventListener("pointerup", soltar);
      document.addEventListener("pointercancel", cancelar);
      document.addEventListener("keydown", tecla, true);
    },
    [container],
  );

  return { linhaRef, arrastando, iniciar };
}

/** A linha vermelha que mostra onde o item vai cair. Fica escondida; o
 *  gesto a posiciona. Mora dentro do card da planilha. */
export const LinhaDeInsercao = React.forwardRef<HTMLDivElement>(
  function LinhaDeInsercao(_props, ref) {
    return (
      <div
        ref={ref}
        hidden
        aria-hidden
        className="pointer-events-none absolute z-[5] h-0.5 rounded-full bg-california-red shadow-[0_0_0_2px_rgba(231,75,86,0.15)] before:absolute before:-left-[5px] before:-top-[3px] before:h-2 before:w-2 before:rounded-full before:border-2 before:border-california-red before:bg-white before:content-['']"
      />
    );
  },
);

/** A alça no recuo do item. Só aparece no hover da linha — a `<tr>`
 *  carrega `group/linha`. */
export function AlcaDaLinha({
  rotulo,
  onPointerDown,
}: {
  rotulo: string;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      // Fora da ordem do Tab: quem anda pelo teclado é a seleção da
      // planilha, e o atalho de mover é Alt + ↑ ↓ na célula.
      tabIndex={-1}
      aria-label={`Mudar ${rotulo} de lugar`}
      title="Arraste para mudar a ordem · Alt + ↑ ↓ no teclado"
      onPointerDown={onPointerDown}
      className={cn(
        "absolute left-[6px] top-1/2 z-[2] inline-flex h-[22px] w-[18px] -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-[5px] text-muted-foreground/70 opacity-0 transition-opacity",
        "hover:bg-[#f1efea] hover:text-foreground group-hover/linha:opacity-100",
      )}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}
