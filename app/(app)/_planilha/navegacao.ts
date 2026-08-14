/** Navegação por teclado nas planilhas — Tab anda, Enter desce.
 *
 *  As duas grades editáveis do sistema (a de orçamento e a do realizado
 *  do job) têm o mesmo modelo: uma lista de linhas, uma lista ordenada de
 *  colunas editáveis, e uma célula ativa. O que muda entre elas é só o
 *  conteúdo dessas listas — 9 colunas no orçamento, 3 no job. A regra de
 *  "qual é a próxima" é idêntica, então mora aqui.
 *
 *  Colunas calculadas (Total, Rentabilidade) não entram na lista: quem
 *  monta a sequência passa só o que é editável, e o Tab pula o resto sem
 *  precisar saber que ele existe.
 *
 *  Sem "use client": é função pura, importada pelos dois componentes
 *  client.
 */

/** Para onde a tecla leva. Tab anda na horizontal e vira a linha no fim;
 *  Enter anda na vertical, na mesma coluna. */
export type Direcao = "proxima" | "anterior" | "abaixo" | "acima";

export interface Celula<C extends string> {
  linhaId: string;
  campo: C;
}

/**
 * A célula vizinha, ou `null` quando não há para onde ir — e aí quem
 * chama encerra a edição.
 *
 * Tab na última coluna desce para a PRIMEIRA coluna da linha seguinte
 * (decisão do time, 13/08/2026: comportamento de planilha). Shift+Tab faz
 * o caminho inverso, caindo na última coluna da linha de cima.
 */
export function celulaVizinha<C extends string>(
  linhas: readonly string[],
  campos: readonly C[],
  atual: Celula<C>,
  direcao: Direcao,
): Celula<C> | null {
  const linha = linhas.indexOf(atual.linhaId);
  const campo = campos.indexOf(atual.campo);
  // Linha que saiu da tela no meio da edição (removida por outra aba, ou
  // rascunho que acabou de virar item real): sem âncora, encerra.
  if (linha < 0 || campo < 0) return null;

  if (direcao === "abaixo" || direcao === "acima") {
    const alvo = linha + (direcao === "abaixo" ? 1 : -1);
    if (alvo < 0 || alvo >= linhas.length) return null;
    return { linhaId: linhas[alvo], campo: atual.campo };
  }

  const passo = direcao === "proxima" ? 1 : -1;
  const alvoCampo = campo + passo;
  if (alvoCampo >= 0 && alvoCampo < campos.length) {
    return { linhaId: atual.linhaId, campo: campos[alvoCampo] };
  }

  const alvoLinha = linha + passo;
  if (alvoLinha < 0 || alvoLinha >= linhas.length) return null;
  return {
    linhaId: linhas[alvoLinha],
    campo: passo > 0 ? campos[0] : campos[campos.length - 1],
  };
}

/** Traduz a tecla em direção, considerando só Tab e Enter. `null` quando
 *  a tecla não navega — e aí o handler devolve o evento ao navegador.
 *
 *  É esta a versão usada pelas células de `<select>`: lá as setas são do
 *  dropdown, que precisa delas para percorrer as opções. */
export function direcaoDaTecla(e: {
  key: string;
  shiftKey: boolean;
}): Direcao | null {
  if (e.key === "Tab") return e.shiftKey ? "anterior" : "proxima";
  if (e.key === "Enter") return e.shiftKey ? "acima" : "abaixo";
  return null;
}

/**
 * Idem, mas dentro de um campo de texto — onde as setas também navegam.
 *
 * O conflito é real: num campo em edição, ← e → movem o CURSOR. Roubar as
 * duas para a navegação tornaria impossível corrigir o meio de uma
 * descrição sem apagar tudo e redigitar. A regra que preserva as duas
 * coisas:
 *
 *   - **↑ e ↓ sempre navegam.** O campo é de uma linha só, então não há
 *     cursor a mover na vertical — não há o que perder.
 *   - **← e → só navegam na borda**: ← com o cursor na primeira posição,
 *     → com ele na última, e nenhum dos dois com texto selecionado.
 *     Dentro do texto elas continuam sendo do cursor.
 *   - **Shift+seta nunca navega** — é seleção de texto.
 *
 * Efeito colateral aceito: como o campo entra com o valor todo
 * selecionado (`select()` no foco), a primeira → apenas desfaz a seleção
 * e leva o cursor ao fim; a segunda é que anda. É o preço de não quebrar
 * a edição de texto, e vale para a coluna Item, que é onde alguém
 * realmente digita frase.
 */
export function direcaoNoCampo(
  e: { key: string; shiftKey: boolean },
  campo: {
    selectionStart: number | null;
    selectionEnd: number | null;
    value: string;
  },
): Direcao | null {
  const porTabOuEnter = direcaoDaTecla(e);
  if (porTabOuEnter) return porTabOuEnter;

  // Shift+seta é seleção de texto, não navegação.
  if (e.shiftKey) return null;

  if (e.key === "ArrowDown") return "abaixo";
  if (e.key === "ArrowUp") return "acima";

  const inicio = campo.selectionStart ?? 0;
  const fim = campo.selectionEnd ?? 0;
  if (inicio !== fim) return null; // há texto selecionado: seta é do cursor

  if (e.key === "ArrowLeft" && inicio === 0) return "anterior";
  if (e.key === "ArrowRight" && fim === campo.value.length) return "proxima";
  return null;
}
