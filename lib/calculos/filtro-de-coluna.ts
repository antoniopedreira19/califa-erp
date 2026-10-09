/**
 * A conta do filtro pelo título da coluna (decisão 165), sem React: o que o
 * filtro de uma coluna guarda, se uma linha passa nele e como um clique na
 * lista muda o que está guardado. O cartão e o gancho moram em
 * `components/ui/filtro-de-coluna.tsx`, que reexporta tudo daqui.
 *
 * Testes: node --import tsx --test lib/calculos/filtro-de-coluna.test.ts
 */

/** O filtro de uma coluna. Vazio = a coluna não filtra. */
export interface FiltroDaColuna {
  /** O texto buscado dentro da coluna. */
  busca: string;
  /**
   * A lista guarda a INTENÇÃO de quem filtrou (09/10/2026), e não só o que
   * estava marcado na hora — os chips e a busca de cima trocam os valores
   * da coluna por baixo do filtro:
   *
   *   * `marcados` — "só estes": quem desmarcou "(Selecionar tudo)" e
   *     escolheu alguns. Valor que aparecer depois chega desmarcado;
   *   * `desmarcados` — "todos menos estes": quem tirou um ou outro (mesmo
   *     que seja o único valor da coluna). Valor que aparecer depois chega
   *     marcado. Era o caso que dava "Mostrando 0 de 13": desmarcar "Parcial"
   *     em "A pagar" e trocar o chip para "Pagos", cujo "Pago" não existia na
   *     hora do filtro.
   *
   * O grupo inteiro da árvore entra como marca própria (`marcaDoGrupo`):
   * desmarcar "PPs" na Origem dos Títulos a Pagar vale para qualquer PP,
   * inclusive as dos "Pagos", que não estavam na tela. Guardando só os
   * códigos de então, as PPs pagas voltavam ao trocar o chip.
   *
   * Os dois `null` = a coluna não filtra por lista.
   */
  marcados: string[] | null;
  desmarcados?: string[] | null;
  /** A faixa da coluna de valor (só no tipo `faixa`). */
  de: number | null;
  ate: number | null;
}

export const FILTRO_VAZIO: FiltroDaColuna = { busca: "", marcados: null, desmarcados: null, de: null, ate: null };

export function filtroAtivo(f: FiltroDaColuna | undefined): boolean {
  return (
    !!f &&
    (f.busca.trim() !== "" || f.marcados !== null || (f.desmarcados ?? null) !== null || f.de !== null || f.ate !== null)
  );
}

const PREFIXO_DE_GRUPO = "\u0001";

/** A marca do grupo inteiro na lista guardada. O caractere de controle na
 *  frente não aparece em valor nenhum, então não colide com eles. */
export function marcaDoGrupo(grupo: string): string {
  return PREFIXO_DE_GRUPO + grupo;
}

function ehMarcaDeGrupo(v: string): boolean {
  return v.startsWith(PREFIXO_DE_GRUPO);
}

/** O valor (do grupo `grupo`, na árvore) está marcado no filtro da coluna? */
export function marcadoNoFiltro(f: FiltroDaColuna, valor: string, grupo?: string): boolean {
  const g = grupo === undefined ? null : marcaDoGrupo(grupo);
  if (f.marcados !== null) return f.marcados.includes(valor) || (g !== null && f.marcados.includes(g));
  if (f.desmarcados) return !f.desmarcados.includes(valor) && !(g !== null && f.desmarcados.includes(g));
  return true;
}

/** Sem acento e em minúsculas: "Diárias" acha "diarias". */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * O filtro depois de um clique na lista: `novos` é o que fica marcado entre
 * os valores da lista de agora (os que as OUTRAS colunas deixaram).
 *
 *   * tudo marcado = a coluna deixa de filtrar por lista;
 *   * `recomecar` ("(Selecionar tudo)" desmarcado, sem busca) ou já em "só
 *     estes" = "só estes";
 *   * o resto = "todos menos estes" — inclusive desmarcar o único valor da
 *     coluna, que quer dizer "menos este", e não "nenhum" (o "Em avaliação"
 *     das PPs, que zerava as Aprovadas ao trocar o chip).
 *
 * O que está fora da lista de agora (escondido por outra coluna) fica como
 * estava. A marca de um grupo inteiro fica enquanto o grupo continua inteiro
 * (todo marcado em "só estes", todo fora em "todos menos estes"); `grupo` é
 * o grupo que o clique marcou ou desmarcou de uma vez.
 */
export function novoFiltroDaLista(
  filtro: FiltroDaColuna,
  valores: ReadonlyArray<{ valor: string; grupo?: string }>,
  novos: Iterable<string>,
  { grupo, recomecar = false }: { grupo?: string; recomecar?: boolean } = {},
): FiltroDaColuna {
  const m = new Set(novos);
  const daLista = valores.map((v) => v.valor);
  if (daLista.every((v) => m.has(v))) return { ...filtro, marcados: null, desmarcados: null };

  const gruposAgora = new Map<string, string[]>();
  for (const v of valores) {
    if (v.grupo !== undefined) gruposAgora.set(v.grupo, [...(gruposAgora.get(v.grupo) ?? []), v.valor]);
  }
  const soEstes = filtro.marcados !== null || (recomecar && m.size === 0);
  const inteiro = (g: string) => {
    const vs = gruposAgora.get(g);
    return !vs || vs.every((v) => m.has(v) === soEstes);
  };
  const antes = (soEstes ? filtro.marcados : filtro.desmarcados) ?? [];
  const marcas = new Set(antes.filter((v) => ehMarcaDeGrupo(v) && inteiro(v.slice(PREFIXO_DE_GRUPO.length))));
  if (grupo !== undefined && inteiro(grupo)) marcas.add(marcaDoGrupo(grupo));
  const fora = antes.filter((v) => !ehMarcaDeGrupo(v) && !daLista.includes(v));
  const daqui = soEstes ? daLista.filter((v) => m.has(v)) : daLista.filter((v) => !m.has(v));
  const lista = [...fora, ...daqui, ...marcas];
  return soEstes
    ? { ...filtro, marcados: lista, desmarcados: null }
    : { ...filtro, marcados: null, desmarcados: lista };
}

// ---- As células -------------------------------------------------------------

/** O que uma célula mostra para o filtro e para a ordem. */
export interface CelulaDaColuna {
  /** A chave do valor na lista do funil. */
  valor: string;
  /** Como a lista mostra. */
  rotulo: string;
  /** A chave da ordem: número ordena como número. */
  ordem: string | number;
  /** A posição do valor na LISTA do funil, quando difere da ordem das
   *  linhas (as situações na ordem da esteira, ordenando pelo valor). */
  ordemNaLista?: number;
  /** O texto que a busca da coluna procura (o rótulo, se faltar). */
  busca?: string;
  /** O grupo do valor: a lista vira árvore. */
  grupo?: string;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Célula de texto: o valor é o próprio texto; vazio vira "(vazio)", no fim. */
export function celulaTexto(texto: string | null | undefined, ordem?: string | number): CelulaDaColuna {
  const t = texto?.trim() ?? "";
  return t
    ? { valor: t, rotulo: t, ordem: ordem ?? t }
    : { valor: "", rotulo: "(vazio)", ordem: ordem ?? "￿" };
}

/** Célula de data (ISO): o dia na lista, dentro do mês, como no Excel. */
export function celulaData(iso: string | null | undefined, sufixo = ""): CelulaDaColuna {
  if (!iso) return { valor: "", rotulo: "(sem data)", ordem: "9999-99-99", grupo: "" };
  const d = iso.slice(0, 10);
  const [a, m, dia] = d.split("-");
  return {
    valor: sufixo ? `${sufixo}:${d}` : d,
    rotulo: `${dia}/${m}/${a}${sufixo ? ` · ${sufixo}` : ""}`,
    ordem: d,
    busca: `${dia}/${m}/${a} ${MESES[Number(m) - 1]} ${a}`,
    grupo: `${MESES[Number(m) - 1]} de ${a}`,
  };
}

/** Célula de dinheiro: ordena e filtra pela faixa. */
export function celulaValor(v: number | null | undefined, formatar: (n: number) => string): CelulaDaColuna {
  const n = v ?? 0;
  return { valor: String(Math.round(n * 100)), rotulo: formatar(n), ordem: n };
}

export function comparar(a: string | number, b: string | number): number {
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR");
}

export function emLista(c: CelulaDaColuna | CelulaDaColuna[]): CelulaDaColuna[] {
  return Array.isArray(c) ? c : [c];
}

/**
 * A linha passa no filtro da coluna? Coluna de faixa olha o número da
 * primeira célula; a de lista passa se ALGUMA célula (as marcas de um
 * projeto, os jobs de um título) bate com a busca e está marcada.
 */
export function passaNaColuna(celulas: CelulaDaColuna[], f: FiltroDaColuna | undefined, faixa: boolean): boolean {
  if (!f || !filtroAtivo(f)) return true;
  if (faixa) {
    const v = Number(celulas[0]?.ordem ?? 0);
    if (f.de !== null && v < f.de - 0.004) return false;
    if (f.ate !== null && v > f.ate + 0.004) return false;
    return true;
  }
  const termo = semAcento(f.busca.trim());
  return celulas.some(
    (c) => (!termo || semAcento(c.busca ?? c.rotulo).includes(termo)) && marcadoNoFiltro(f, c.valor, c.grupo),
  );
}
