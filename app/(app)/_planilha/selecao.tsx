"use client";

/** A máquina de SELEÇÃO das planilhas — a célula selecionada, as setas e
 *  o rodapé de navegação.
 *
 *  Do design `Planilha Interna do Job - Rentabilidade por Item.dc.html`,
 *  turno 2a (projeto Claude Design `69342d83`), 03/09/2026; regra na
 *  decisão 046.
 *
 *  Uma célula de item pode estar SELECIONADA (moldura vermelha; as setas
 *  andam) ou ABERTA (o campo de edição). A tabela é dona da edição; este
 *  hook é dono da seleção e das teclas enquanto nada está aberto:
 *
 *   - ↑ ↓ ← → andam por TODA célula de item, editável ou calculada. Na
 *     borda, ← e → viram a linha, igual ao Tab. Home/End vão aos extremos.
 *   - Enter e F2 abrem a célula selecionada, se ela abre. Digitar um
 *     caractere abre a célula já com ele — como numa planilha, o conteúdo
 *     é substituído sem passar pelo Enter. Célula calculada não abre; nela
 *     o Enter só desce.
 *   - Esc limpa a seleção. Clique fora da grade também.
 *   - Clique numa célula seleciona; clique na célula JÁ selecionada, ou
 *     duplo clique, abre.
 *
 *  Linhas de grupo e de total ficam fora: elas não têm as colunas de um
 *  item, e "descer" de QT para dentro delas não teria onde cair. A coluna
 *  Save também fica fora — é um botão que abre um pop-up, não uma célula.
 *
 *  As DUAS grades editáveis (orçamento e errata do job) e as de leitura
 *  (job, agregada) usam esta mesma máquina — quatro cópias divergiriam na
 *  primeira correção, que foi o que aconteceu com o Tab antes dela.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Direcao } from "./navegacao";
import { SELECAO } from "./blocos";

/** O que a célula abre: campo de texto, campo numérico ou lista. `null`
 *  é célula calculada ou travada — seleciona, mas não abre. */
export type TipoEditor = "texto" | "numero" | "lista";

export type Movimento = Direcao | "inicio" | "fim";

export interface ColunaDaGrade {
  chave: string;
  /** Como a coluna aparece no endereço do rodapé ("R$ Unit."). */
  rotulo: string;
  /** Bloco a que pertence, para o endereço ("Planejado"). Ausente nas
   *  colunas neutras (Item, Tipo, Categoria). */
  bloco?: string | null;
}

export interface CelulaSelecionada {
  linhaId: string;
  coluna: string;
}

export interface OpcoesDaSelecao {
  /** Ids das linhas navegáveis, na ordem da tela. Grupo recolhido não
   *  tem linha na tela e fica fora. */
  linhas: readonly string[];
  /** Colunas visíveis, na ordem — a lista que ← e → percorrem. */
  colunas: readonly ColunaDaGrade[];
  /** O que a célula abre; `null` não abre. */
  editorDe: (linhaId: string, coluna: string) => TipoEditor | null;
  /** Abre a célula. `semente` é o caractere digitado que a abriu, para
   *  o campo já nascer com ele no lugar do conteúdo. */
  onAbrir: (celula: CelulaSelecionada, semente?: string) => void;
  /** ↓ (ou Enter em célula calculada) saindo de uma linha. Devolve `true`
   *  quando a tabela tratou — é assim que a última linha de um grupo
   *  abre o "Novo item" DELE em vez de cair no grupo de baixo. */
  aoDescer?: (linhaId: string) => boolean;
  /** Há célula aberta: as teclas são do campo, não da seleção. */
  editando: boolean;
  /** O card da planilha — recebe o foco para as teclas chegarem e é a
   *  fronteira do "clique fora". */
  wrapperRef: React.RefObject<HTMLElement | null>;
  habilitado?: boolean;
}

export interface Selecao {
  celula: CelulaSelecionada | null;
  selecionar: (celula: CelulaSelecionada | null) => void;
  /** Anda a seleção e devolve para onde foi (`null` = não havia para
   *  onde, ou a tabela tratou). */
  mover: (movimento: Movimento, de?: CelulaSelecionada) => CelulaSelecionada | null;
  /** Devolve o foco ao card, para as setas voltarem a andar depois que
   *  um campo fecha. */
  focar: () => void;
  onKeyDown: React.KeyboardEventHandler;
  estaSelecionada: (linhaId: string, coluna: string) => boolean;
  /** Handlers e marcação da célula — espalhar no `<td>`. */
  celulaProps: (linhaId: string, coluna: string) => {
    onClick: React.MouseEventHandler;
    onDoubleClick: React.MouseEventHandler;
    "data-cel": string;
    className: string;
  };
  /** Classe da moldura para o `<div>` que envolve o conteúdo. */
  moldura: (linhaId: string, coluna: string) => string;
  /** A coluna selecionada, com rótulo e bloco — para o rodapé. */
  colunaSelecionada: ColunaDaGrade | null;
}

function ehCampo(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  return (
    alvo instanceof HTMLInputElement ||
    alvo instanceof HTMLTextAreaElement ||
    alvo instanceof HTMLSelectElement ||
    alvo.isContentEditable ||
    alvo.getAttribute("role") === "combobox"
  );
}

export function useSelecaoPlanilha({
  linhas,
  colunas,
  editorDe,
  onAbrir,
  aoDescer,
  editando,
  wrapperRef,
  habilitado = true,
}: OpcoesDaSelecao): Selecao {
  const [celula, setCelula] = React.useState<CelulaSelecionada | null>(null);

  // Os callbacks por ref: os handlers abaixo são estáveis e leem sempre a
  // versão mais recente, sem re-inscrever nada a cada render.
  const opcoes = React.useRef({ linhas, colunas, editorDe, onAbrir, aoDescer, editando });
  opcoes.current = { linhas, colunas, editorDe, onAbrir, aoDescer, editando };

  const focar = React.useCallback(() => {
    wrapperRef.current?.focus({ preventScroll: true });
  }, [wrapperRef]);

  const selecionar = React.useCallback((c: CelulaSelecionada | null) => {
    setCelula(c);
  }, []);

  // Linha que saiu da tela (grupo recolhido, item removido, rascunho que
  // virou item de verdade): a seleção morre com ela.
  React.useEffect(() => {
    if (celula && !linhas.includes(celula.linhaId)) setCelula(null);
  }, [linhas, celula]);
  // Coluna que saiu (bloco escondido): idem.
  React.useEffect(() => {
    if (celula && !colunas.some((c) => c.chave === celula.coluna)) setCelula(null);
  }, [colunas, celula]);

  const mover = React.useCallback(
    (movimento: Movimento, de?: CelulaSelecionada): CelulaSelecionada | null => {
      const { linhas: L, colunas: C, aoDescer: descer } = opcoes.current;
      const origem = de ?? celula;
      if (!origem) return null;
      const li = L.indexOf(origem.linhaId);
      const ci = C.findIndex((c) => c.chave === origem.coluna);
      if (li < 0 || ci < 0) return null;

      let alvoL = li;
      let alvoC = ci;
      switch (movimento) {
        case "proxima":
          alvoC = ci + 1;
          if (alvoC >= C.length) {
            if (li + 1 >= L.length) return null;
            alvoC = 0;
            alvoL = li + 1;
          }
          break;
        case "anterior":
          alvoC = ci - 1;
          if (alvoC < 0) {
            if (li === 0) return null;
            alvoC = C.length - 1;
            alvoL = li - 1;
          }
          break;
        case "abaixo":
          // A tabela pode preferir abrir a linha nova do grupo a descer.
          if (descer?.(origem.linhaId)) return null;
          if (li + 1 >= L.length) return null;
          alvoL = li + 1;
          break;
        case "acima":
          if (li === 0) return null;
          alvoL = li - 1;
          break;
        case "inicio":
          alvoC = 0;
          break;
        case "fim":
          alvoC = C.length - 1;
          break;
      }
      const destino = { linhaId: L[alvoL], coluna: C[alvoC].chave };
      setCelula(destino);
      return destino;
    },
    [celula],
  );

  const onKeyDown = React.useCallback<React.KeyboardEventHandler>(
    (e) => {
      const { editorDe: editor, onAbrir: abrir, editando: aberta } = opcoes.current;
      // Campo aberto: as teclas são dele. A guarda pelo alvo é para o caso
      // de um campo que não passou pelo estado da tabela (o input do nome
      // da errata, por exemplo) — sem ela a seta andaria e o texto também.
      if (aberta || ehCampo(e.target)) return;
      if (!celula) return;

      const teclas: Record<string, Movimento> = {
        ArrowRight: "proxima",
        ArrowLeft: "anterior",
        ArrowDown: "abaixo",
        ArrowUp: "acima",
        Home: "inicio",
        End: "fim",
      };

      if (e.key === "Escape") {
        e.preventDefault();
        setCelula(null);
        return;
      }
      if (e.key === "Tab") {
        // preventDefault é o que segura o foco no card: quem decide para
        // onde ir é a grade, não a ordem do DOM.
        e.preventDefault();
        mover(e.shiftKey ? "anterior" : "proxima");
        return;
      }
      if (e.key in teclas) {
        e.preventDefault();
        mover(teclas[e.key]);
        return;
      }
      const tipo = editor(celula.linhaId, celula.coluna);
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        if (tipo) abrir(celula);
        // Célula calculada: o Enter só desce, como numa planilha.
        else if (e.key === "Enter") mover(e.shiftKey ? "acima" : "abaixo");
        return;
      }
      // Digitar direto substitui o conteúdo — a lista só abre.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!tipo) return;
        e.preventDefault();
        abrir(celula, tipo === "lista" ? undefined : e.key);
      }
    },
    [celula, mover],
  );

  // Clique fora do card limpa a seleção — menos o menu do Radix, que
  // abre em portal fora do card e é parte da célula aberta.
  React.useEffect(() => {
    if (!celula) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target instanceof Element ? e.target : null;
      if (!alvo) return;
      if (wrapperRef.current?.contains(alvo)) return;
      if (alvo.closest("[data-radix-popper-content-wrapper]")) return;
      if (alvo.closest("[role=dialog]")) return;
      setCelula(null);
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [celula, wrapperRef]);

  const estaSelecionada = React.useCallback(
    (linhaId: string, coluna: string) =>
      celula !== null && celula.linhaId === linhaId && celula.coluna === coluna,
    [celula],
  );

  const celulaProps = React.useCallback(
    (linhaId: string, coluna: string) => ({
      onClick: (e: React.MouseEvent) => {
        if (!habilitado) return;
        // Clique num botão dentro da célula (o lápis, a lixeira) é do
        // botão, não da seleção.
        if (e.target instanceof Element && e.target.closest("button, a")) return;
        const jaEstava =
          celula !== null && celula.linhaId === linhaId && celula.coluna === coluna;
        setCelula({ linhaId, coluna });
        focar();
        // Clique na célula JÁ selecionada abre — o caminho do mouse.
        if (jaEstava && opcoes.current.editorDe(linhaId, coluna)) {
          opcoes.current.onAbrir({ linhaId, coluna });
        }
      },
      onDoubleClick: () => {
        if (!habilitado) return;
        if (opcoes.current.editorDe(linhaId, coluna)) {
          setCelula({ linhaId, coluna });
          opcoes.current.onAbrir({ linhaId, coluna });
        }
      },
      "data-cel": `${linhaId}:${coluna}`,
      className: habilitado ? SELECAO.celula : "",
    }),
    [celula, focar, habilitado],
  );

  const moldura = React.useCallback(
    (linhaId: string, coluna: string) =>
      estaSelecionada(linhaId, coluna) ? SELECAO.moldura : "",
    [estaSelecionada],
  );

  const colunaSelecionada = React.useMemo(
    () => (celula ? colunas.find((c) => c.chave === celula.coluna) ?? null : null),
    [celula, colunas],
  );

  return {
    celula,
    selecionar,
    mover,
    focar,
    onKeyDown,
    estaSelecionada,
    celulaProps,
    moldura,
    colunaSelecionada,
  };
}

/** Wrapper de conteúdo de uma célula navegável: é nele que a moldura
 *  aparece. Bloco (`block`) por padrão; `flex` quando o conteúdo já é uma
 *  linha de coisas (chevron + nome, badge + tag). */
export function Miolo({
  moldura,
  className,
  children,
}: {
  moldura: string;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("min-w-0", className, moldura)}>{children}</div>;
}

/** A linha de dicas de teclado, FORA do card — a tabela (ou a tela que
 *  desenha o card) a põe logo abaixo dele. Sem endereço nem valor da
 *  célula: a moldura já diz qual está selecionada (Tiago, 03/09/2026).
 *  Numa planilha só de leitura as dicas de Enter e digitação somem —
 *  elas mentiriam. */
export function DicasDeTeclado({ editavel }: { editavel: boolean }) {
  return (
    <p className={SELECAO.dicas}>
      <span>
        <span className={SELECAO.tecla}>↑ ↓ ← →</span> anda
      </span>
      {editavel && (
        <>
          <span>· <span className={SELECAO.tecla}>Enter</span> abre a célula</span>
          <span>· digitar já substitui</span>
          <span>· <span className={SELECAO.tecla}>Enter</span> no campo desce</span>
        </>
      )}
      <span>
        · <span className={SELECAO.tecla}>Home</span> /{" "}
        <span className={SELECAO.tecla}>End</span> extremos
      </span>
      <span>
        · <span className={SELECAO.tecla}>Esc</span> cancela
      </span>
    </p>
  );
}
