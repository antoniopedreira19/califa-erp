"use client";

/** A calha de ações da planilha — a faixa que vive FORA do frame da
 *  tabela, ao lado das linhas.
 *
 *  Enquanto cada agrupamento era uma tabela própria, alinhar a calha era
 *  aritmética: todas as linhas tinham a MESMA altura (`h-7`), então
 *  bastava saber onde o `tbody` começava e empilhar caixas dessa altura.
 *  Com os grupos numa tabela só isso não fecha mais — a linha do grupo
 *  tem 40px, a de item tem 28, a do "Novo item" tem 30, e a do planejado
 *  na vista Líquido cresce mais um degrau por causa da sub-linha do BV.
 *  Altura chutada erra por alguns pixels em cada troca de trecho, e o
 *  erro se acumula: lá pelo terceiro grupo a lixeira já aponta para a
 *  linha errada.
 *
 *  A saída é medir. Cada `<tr>` que quer companhia na calha se marca com
 *  `data-calha="<chave>"`, e este módulo lê a posição real dela para
 *  posicionar a pílula na mesma altura. Funciona com qualquer altura de
 *  linha, inclusive as que mudam depois de renderizadas.
 *
 *  Regra que não muda: a calha nunca alarga a tabela. Ela é `absolute
 *  left-full`, e quem reserva o espaço é a página, com um `pr-` do
 *  tamanho exato — ver `calha-acoes.tsx`.
 */

import * as React from "react";

export interface PosicaoCalha {
  /** Distância do topo do wrapper até o topo da linha, em px. */
  top: number;
  /** Altura da linha, em px. */
  altura: number;
}

export type PosicoesCalha = Record<string, PosicaoCalha>;

/** Comparação rasa: sem ela o `setState` dentro do ResizeObserver
 *  dispararia uma nova medição a cada medição, em laço. */
function mesmasPosicoes(a: PosicoesCalha, b: PosicoesCalha): boolean {
  const chavesA = Object.keys(a);
  const chavesB = Object.keys(b);
  if (chavesA.length !== chavesB.length) return false;
  for (const chave of chavesA) {
    const pa = a[chave];
    const pb = b[chave];
    if (!pb) return false;
    // Meio pixel de diferença é ruído de layout, não movimento real.
    if (Math.abs(pa.top - pb.top) > 0.5) return false;
    if (Math.abs(pa.altura - pb.altura) > 0.5) return false;
  }
  return true;
}

/**
 * Onde cada linha marcada com `data-calha` está, em relação ao wrapper.
 *
 * O wrapper precisa ser o mesmo elemento `relative` que hospeda a calha —
 * é dele que sai o `top` de cada pílula.
 */
export function usePosicoesDaCalha(
  wrapperRef: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList,
): PosicoesCalha {
  const [posicoes, setPosicoes] = React.useState<PosicoesCalha>({});

  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const medir = () => {
      const topoWrapper = wrapper.getBoundingClientRect().top;
      const next: PosicoesCalha = {};
      wrapper
        .querySelectorAll<HTMLElement>("[data-calha]")
        .forEach((el) => {
          const chave = el.dataset.calha;
          if (!chave) return;
          const retangulo = el.getBoundingClientRect();
          next[chave] = {
            top: retangulo.top - topoWrapper,
            altura: retangulo.height,
          };
        });
      setPosicoes((prev) => (mesmasPosicoes(prev, next) ? prev : next));
    };

    medir();

    // Observa o wrapper inteiro: qualquer linha que cresça (a sub-linha
    // do BV, um nome que quebra em duas linhas) muda a altura dele.
    const observer = new ResizeObserver(medir);
    observer.observe(wrapper);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return posicoes;
}

/** O contêiner da calha — encosta na borda direita da tabela e não
 *  ocupa espaço no fluxo. */
export function Calha({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        className ?? "pointer-events-none absolute left-full top-0 ml-2"
      }
    >
      {children}
    </div>
  );
}

/**
 * Uma pílula da calha, presa à altura da linha que ela acompanha.
 *
 * Sem posição medida ainda (primeiro render) devolve `null`: melhor a
 * pílula aparecer um quadro depois do que aparecer no lugar errado e
 * pular para o certo.
 */
export function LinhaDaCalha({
  posicao,
  children,
}: {
  posicao: PosicaoCalha | undefined;
  children: React.ReactNode;
}) {
  if (!posicao) return null;
  return (
    <div
      className="pointer-events-auto absolute left-0 flex items-center"
      style={{ top: posicao.top, height: posicao.altura }}
    >
      {children}
    </div>
  );
}
