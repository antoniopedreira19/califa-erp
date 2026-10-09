"use client";

/**
 * Filtro e ordenação pelo título da coluna, como no Excel (pedido do Tiago,
 * 08/10/2026, para a aba Pedidos de Produção do job).
 *
 * O título vira um botão. Ele abre um cartão com:
 *
 *   * as duas ordens da coluna (A a Z, do mais antigo ao mais novo, do menor
 *     ao maior — conforme o tipo). Clicar na ordem que já vale tira a ordem;
 *   * a busca DENTRO da coluna: o texto já filtra as linhas, e a lista de
 *     valores embaixo se reduz ao que bate;
 *   * a lista de valores da coluna, com quantas linhas tem cada um, para
 *     marcar e desmarcar — "(Selecionar tudo)" no topo;
 *   * ou, na coluna de valor (`faixa`), o "de / até" no lugar da lista;
 *   * com `grupo` nos valores, a lista vira árvore, como as datas do Excel:
 *     o grupo (o bloco da planilha) marca e desmarca todos os seus valores,
 *     e abre para escolher um a um. A busca acha pelo nome do grupo também.
 *
 * Tudo vale na hora, sem botão de aplicar. O título mostra o funil vermelho
 * quando a coluna filtra e a seta quando ordena.
 *
 * O componente não sabe nada de PP: quem usa entrega os valores e guarda o
 * estado. Serve às outras listas do ERP (Títulos a Pagar, Faturamento…).
 */

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Filter, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/lib/utils";
import {
  FILTRO_VAZIO,
  comparar,
  emLista,
  filtroAtivo,
  marcadoNoFiltro,
  novoFiltroDaLista,
  passaNaColuna,
  semAcento,
  type CelulaDaColuna,
  type FiltroDaColuna,
} from "@/lib/calculos/filtro-de-coluna";

// A conta mora em lib/calculos (testável sem React); quem usa o filtro
// importa tudo daqui, como antes.
export {
  FILTRO_VAZIO,
  celulaData,
  celulaTexto,
  celulaValor,
  filtroAtivo,
  marcaDoGrupo,
  marcadoNoFiltro,
  semAcento,
  type CelulaDaColuna,
  type FiltroDaColuna,
} from "@/lib/calculos/filtro-de-coluna";

export type DirecaoDaOrdem = "asc" | "desc";

/** Um valor da coluna, como aparece na lista. */
export interface ValorDaColuna {
  /** A chave do valor (a data ISO, o nome…). */
  valor: string;
  /** Como a lista mostra. */
  rotulo: string;
  /** Quantas linhas têm esse valor, com os filtros das OUTRAS colunas. */
  quantas: number;
  /** O grupo do valor (o bloco do item): com ele, a lista vira árvore. */
  grupo?: string;
}

const ORDENS: Record<"texto" | "data" | "valor", [string, string]> = {
  texto: ["Ordenar de A a Z", "Ordenar de Z a A"],
  data: ["Do mais antigo para o mais novo", "Do mais novo para o mais antigo"],
  valor: ["Do menor para o maior", "Do maior para o menor"],
};

export function FiltroDeColuna({
  rotulo,
  tipo,
  faixa = false,
  valores,
  filtro,
  onFiltro,
  ordem,
  onOrdem,
  alinhar = "left",
  rotuloSemGrupo = "(sem bloco)",
  className,
}: {
  rotulo: string;
  /** Como a árvore chama o grupo vazio ("(sem bloco)" na aba PPs). */
  rotuloSemGrupo?: string;
  /** Decide os nomes das ordens. */
  tipo: "texto" | "data" | "valor";
  /** A coluna de valor filtra por "de / até" em vez de lista. */
  faixa?: boolean;
  valores: ValorDaColuna[];
  filtro: FiltroDaColuna;
  onFiltro: (f: FiltroDaColuna) => void;
  /** A ordem desta coluna, ou `null` quando outra coluna (ou nenhuma) ordena. */
  ordem: DirecaoDaOrdem | null;
  onOrdem: (d: DirecaoDaOrdem | null) => void;
  /** `center` para os títulos centralizados (Início, Status…): o cartão
   *  abre centrado embaixo do título. */
  alinhar?: "left" | "right" | "center";
  className?: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  /** Os grupos abertos na árvore. Com busca, todos abrem. */
  const [abertos, setAbertos] = React.useState<string[]>([]);
  const ativo = filtroAtivo(filtro);
  const termo = semAcento(filtro.busca.trim());
  const agrupado = valores.some((v) => v.grupo !== undefined);
  const visiveis = termo
    ? valores.filter(
        (v) => semAcento(v.rotulo).includes(termo) || semAcento(v.grupo ?? "").includes(termo),
      )
    : valores;
  const grupos = agrupado ? Array.from(new Set(visiveis.map((v) => v.grupo ?? ""))) : [];
  const grupoDe = new Map(valores.map((v) => [v.valor, v.grupo]));
  const marcado = (v: string) => marcadoNoFiltro(filtro, v, grupoDe.get(v));
  const todosMarcados = visiveis.every((v) => marcado(v.valor));
  /** Os valores marcados da lista de agora (os que as OUTRAS colunas
   *  deixaram). */
  const marcadosAgora = valores.map((x) => x.valor).filter(marcado);

  /** Grava o clique guardando a intenção (`novoFiltroDaLista`). */
  function gravar(novos: string[], grupo?: string, recomecar = false) {
    onFiltro(novoFiltroDaLista(filtro, valores, novos, { grupo, recomecar }));
  }

  function alternar(v: string) {
    gravar(marcado(v) ? marcadosAgora.filter((x) => x !== v) : [...marcadosAgora, v]);
  }

  /** Marca ou desmarca de uma vez os valores de um grupo. */
  function alternarGrupo(grupo: string) {
    const doGrupo = visiveis.filter((v) => (v.grupo ?? "") === grupo).map((v) => v.valor);
    const tudoMarcado = doGrupo.every((v) => marcado(v));
    gravar(
      tudoMarcado
        ? marcadosAgora.filter((x) => !doGrupo.includes(x))
        : Array.from(new Set([...marcadosAgora, ...doGrupo])),
      // Com busca, o clique pega só parte do grupo: aí não vale o grupo todo.
      termo === "" ? grupo : undefined,
    );
  }

  function alternarTodos() {
    const doFiltro = visiveis.map((x) => x.valor);
    gravar(
      todosMarcados
        ? marcadosAgora.filter((x) => !doFiltro.includes(x))
        : Array.from(new Set([...marcadosAgora, ...doFiltro])),
      undefined,
      // Sem busca, desmarcar tudo é começar do zero para escolher alguns.
      todosMarcados && termo === "",
    );
  }

  const [rotuloAsc, rotuloDesc] = ORDENS[tipo];

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filtrar e ordenar por ${rotulo}`}
          className={cn(
            // `align-middle`: com `flex-row-reverse` (título à direita) o botão
            // descia 2 px em relação aos títulos à esquerda.
            "group inline-flex max-w-full items-center gap-1 align-middle uppercase tracking-wider transition-colors hover:text-foreground",
            alinhar === "right" && "flex-row-reverse",
            (ativo || ordem) && "text-foreground",
            className,
          )}
        >
          {/* Quebra em duas linhas em vez de cortar: o título é o que diz
              o que a coluna é. */}
          <span className={cn("leading-tight", alinhar === "right" ? "text-right" : alinhar === "center" ? "text-center" : "text-left")}>{rotulo}</span>
          <span className={cn("inline-flex flex-none items-center gap-0.5", alinhar === "right" && "flex-row-reverse")}>
            {ordem === "asc" && <ArrowUp className="h-3 w-3" />}
            {ordem === "desc" && <ArrowDown className="h-3 w-3" />}
            {/* A seta da ordem toma o lugar da setinha de abrir (09/10/2026):
                somadas, o título alargava e quebrava em colunas estreitas. */}
            {ativo ? (
              <Filter className="h-3 w-3 fill-california-red text-california-red" />
            ) : (
              !ordem && <ChevronDown className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-80" />
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={alinhar === "right" ? "end" : alinhar === "center" ? "center" : "start"}
        className="w-[272px] p-0 normal-case tracking-normal"
      >
        <div className="flex flex-col py-1.5">
          {(["asc", "desc"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onOrdem(ordem === d ? null : d)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] font-medium transition-colors hover:bg-muted",
                ordem === d && "text-california-red",
              )}
            >
              {d === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              {d === "asc" ? rotuloAsc : rotuloDesc}
              {ordem === d && <span className="ml-auto text-[10.5px] text-muted-foreground">clique para tirar</span>}
            </button>
          ))}
        </div>
        <div className="border-t border-border p-2.5">
          {faixa ? (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">Valor entre</span>
              <div className="flex items-center gap-2">
                <CampoValor
                  id={`filtro-${rotulo}-de`}
                  rotulo="De"
                  valor={filtro.de}
                  onValor={(de) => onFiltro({ ...filtro, de })}
                />
                <CampoValor
                  id={`filtro-${rotulo}-ate`}
                  rotulo="Até"
                  valor={filtro.ate}
                  onValor={(ate) => onFiltro({ ...filtro, ate })}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  id={`filtro-${rotulo}-busca`}
                  autoFocus
                  value={filtro.busca}
                  onChange={(e) => onFiltro({ ...filtro, busca: e.target.value })}
                  placeholder={`Buscar em ${rotulo}`}
                  className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-7 text-xs outline-none focus:border-california-red/40"
                />
                {filtro.busca && (
                  <button
                    type="button"
                    onClick={() => onFiltro({ ...filtro, busca: "" })}
                    aria-label="Limpar a busca"
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                {visiveis.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-muted-foreground">Nenhum valor com essa busca.</p>
                ) : (
                  <>
                    <LinhaDeValor
                      rotulo="(Selecionar tudo)"
                      marcado={todosMarcados}
                      onAlternar={alternarTodos}
                      negrito
                    />
                    {agrupado
                      ? grupos.map((g) => {
                          const filhos = visiveis.filter((v) => (v.grupo ?? "") === g);
                          const marcadosNoGrupo = filhos.filter((v) => marcado(v.valor)).length;
                          const abertoNaArvore = termo !== "" || abertos.includes(g);
                          return (
                            <React.Fragment key={g}>
                              <LinhaDeValor
                                rotulo={g || rotuloSemGrupo}
                                quantas={filhos.reduce((n, v) => n + v.quantas, 0)}
                                marcado={marcadosNoGrupo === filhos.length}
                                parcial={marcadosNoGrupo > 0 && marcadosNoGrupo < filhos.length}
                                onAlternar={() => alternarGrupo(g)}
                                negrito
                                expansor={
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setAbertos((a) => (a.includes(g) ? a.filter((x) => x !== g) : [...a, g]));
                                    }}
                                    aria-label={abertoNaArvore ? `Fechar ${g}` : `Abrir ${g}`}
                                    aria-expanded={abertoNaArvore}
                                    className="-ml-1 inline-flex h-4 w-4 flex-none items-center justify-center rounded text-muted-foreground hover:bg-muted"
                                  >
                                    <ChevronRight
                                      className={cn("h-3.5 w-3.5 transition-transform", abertoNaArvore && "rotate-90")}
                                    />
                                  </button>
                                }
                              />
                              {abertoNaArvore &&
                                filhos.map((v) => (
                                  <LinhaDeValor
                                    key={v.valor}
                                    rotulo={v.rotulo}
                                    quantas={v.quantas}
                                    marcado={marcado(v.valor)}
                                    onAlternar={() => alternar(v.valor)}
                                    recuo
                                  />
                                ))}
                            </React.Fragment>
                          );
                        })
                      : visiveis.map((v) => (
                          <LinhaDeValor
                            key={v.valor}
                            rotulo={v.rotulo}
                            quantas={v.quantas}
                            marcado={marcado(v.valor)}
                            onAlternar={() => alternar(v.valor)}
                          />
                        ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => onFiltro(FILTRO_VAZIO)}
            disabled={!ativo}
            className="text-[12px] font-semibold text-california-red transition-colors hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          >
            Limpar filtro
          </button>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="rounded-lg border border-border bg-white px-3 py-1 text-[12px] font-semibold hover:bg-muted"
          >
            Fechar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinhaDeValor({
  rotulo,
  quantas,
  marcado,
  parcial = false,
  onAlternar,
  negrito = false,
  recuo = false,
  expansor,
}: {
  rotulo: string;
  quantas?: number;
  marcado: boolean;
  /** Parte do grupo marcada: o traço no lugar do visto. */
  parcial?: boolean;
  onAlternar: () => void;
  negrito?: boolean;
  /** Valor dentro de um grupo da árvore. */
  recuo?: boolean;
  /** A seta que abre o grupo. */
  expansor?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-[12px] last:border-0 hover:bg-muted/60",
        recuo && "pl-9",
      )}
    >
      {expansor}
      {/* A mesma caixa da seleção de linhas da remessa CNAB. */}
      <input
        type="checkbox"
        checked={marcado}
        ref={(el) => {
          if (el) el.indeterminate = parcial;
        }}
        onChange={onAlternar}
        className="h-3.5 w-3.5 flex-none accent-california-red"
      />
      <span className={cn("min-w-0 flex-1 truncate", negrito && "font-semibold")}>{rotulo}</span>
      {quantas !== undefined && (
        <span className="flex-none font-mono text-[10.5px] text-muted-foreground">{quantas}</span>
      )}
    </label>
  );
}

/** Valor em reais, no campo de dinheiro do ERP. Zero = sem limite. */
function CampoValor({
  id,
  rotulo,
  valor,
  onValor,
}: {
  id: string;
  rotulo: string;
  valor: number | null;
  onValor: (v: number | null) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[10.5px] text-muted-foreground">{rotulo}</span>
      <MoneyInput
        id={id}
        aria-label={`Valor ${rotulo.toLowerCase()}`}
        value={valor}
        onValueChange={(v) => onValor(v > 0 ? v : null)}
        className="h-8 font-mono text-xs"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// O filtro inteiro de uma tabela (pedido do Tiago, 09/10/2026: levar o filtro
// da aba PPs às listas de Orçamentos, Jobs, Abertura de Job, Contas a Pagar e
// a Receber, Conciliação e Fiscal).
//
// A aba PPs escreveu a conta à mão (célula, passa, valores, ordem). Aqui ela
// vira um gancho: a tela declara as colunas — o que cada célula mostra — e
// recebe as linhas filtradas e ordenadas, o título pronto de cada coluna e a
// barra "Mostrando X de Y". A conta é a MESMA da aba PPs:
//
//   * a lista de valores de uma coluna é o que sobra com os filtros das
//     OUTRAS colunas, como no Excel;
//   * uma coluna ordena por vez; sem nenhuma, vale a ordem que a tela já tinha;
//   * os filtros de cima da tela (chips, Selects, busca) continuam valendo e
//     vêm ANTES: o gancho recebe as linhas que já passaram por eles.
//
// O que veio junto (decisão 165), e vale também para a aba PPs, que passou
// a usar o gancho:
//   * célula de VÁRIOS valores (as marcas, as regionais e os GPs de um
//     projeto): a linha passa se ALGUM valor estiver marcado, e conta em
//     cada um deles;
//   * a data vira árvore mês ▸ dia (`celulaData`), como as datas do Excel —
//     em lista de centenas de títulos, a lista de dias soltos não serve;
//   * a lista guarda a intenção ("só estes" × "todos menos estes"; ver
//     `FiltroDaColuna`), para o chip de cima trocar os valores sem esvaziar
//     a tabela;
//   * com `guardarEm`, filtros e ordem ficam na aba do navegador, por tela,
//     e voltam quando a pessoa abre um título e retorna; `contexto` zera ao
//     trocar de conta, período, fatura ou job.
// ---------------------------------------------------------------------------

export interface ColunaFiltravel<L> {
  chave: string;
  rotulo: string;
  tipo: "texto" | "data" | "valor";
  /** Coluna de dinheiro: "de / até" em vez de lista. */
  faixa?: boolean;
  alinhar?: "left" | "right" | "center";
  /** Como a árvore chama o grupo vazio. */
  rotuloSemGrupo?: string;
  /** O que a célula mostra. Lista = célula de vários valores. */
  celula: (linha: L) => CelulaDaColuna | CelulaDaColuna[];
}

export interface OpcoesDosFiltros {
  /**
   * Guarda filtros e ordem na aba do navegador (`sessionStorage`), um
   * conjunto por tela (decisão 165): quem abre um título e volta acha a
   * lista como deixou. Fechar a aba do navegador esquece. Sem a chave, o
   * filtro vive só enquanto a tela está montada (era assim na aba PPs).
   */
  guardarEm?: string;
  /**
   * O que, mudando, zera os filtros: a conta e o período da conciliação, a
   * fatura do cartão, o job da aba PPs. Os valores da lista são outros, e o
   * filtro de antes não diz nada sobre eles.
   */
  contexto?: string;
}

type Ordenacao = { coluna: string; direcao: DirecaoDaOrdem };

const PREFIXO_GUARDADO = "filtro-de-coluna:";

/** O `useLayoutEffect` só existe no navegador: no servidor ele avisa. */
const useEfeitoAntesDaPintura = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function lerGuardado(
  chave: string,
  contexto: string,
): { filtros: Record<string, FiltroDaColuna>; ordenacao: Ordenacao | null } | null {
  try {
    const texto = window.sessionStorage.getItem(PREFIXO_GUARDADO + chave);
    if (!texto) return null;
    const guardado = JSON.parse(texto);
    if ((guardado?.contexto ?? "") !== contexto) return null;
    return { filtros: guardado.filtros ?? {}, ordenacao: guardado.ordenacao ?? null };
  } catch {
    // Aba anônima, armazenamento bloqueado ou texto estragado: começa limpo.
    return null;
  }
}

export function useFiltrosDeColuna<L>(
  linhas: L[],
  colunas: ColunaFiltravel<L>[],
  { guardarEm, contexto = "" }: OpcoesDosFiltros = {},
) {
  const [filtros, setFiltros] = React.useState<Record<string, FiltroDaColuna>>({});
  const [ordenacao, setOrdenacao] = React.useState<Ordenacao | null>(null);
  /** O contexto cujos filtros já foram lidos da aba. Antes disso nada é
   *  gravado — senão o estado vazio do primeiro desenho apagaria o que
   *  estava guardado. */
  const [lidoPara, setLidoPara] = React.useState<string | null>(null);

  // Lê o guardado no primeiro desenho do navegador (o servidor desenha sem
  // filtro, e ler antes da hidratação faria as duas versões divergirem) e
  // a cada troca de contexto — que, sem guardado do contexto novo, zera.
  useEfeitoAntesDaPintura(() => {
    if (!guardarEm) return;
    const chaves = new Set(colunas.map((c) => c.chave));
    const guardado = lerGuardado(guardarEm, contexto);
    setFiltros(
      guardado ? Object.fromEntries(Object.entries(guardado.filtros).filter(([k]) => chaves.has(k))) : {},
    );
    setOrdenacao(guardado?.ordenacao && chaves.has(guardado.ordenacao.coluna) ? guardado.ordenacao : null);
    setLidoPara(contexto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardarEm, contexto]);

  React.useEffect(() => {
    if (!guardarEm || lidoPara !== contexto) return;
    try {
      window.sessionStorage.setItem(
        PREFIXO_GUARDADO + guardarEm,
        JSON.stringify({ contexto, filtros, ordenacao }),
      );
    } catch {
      // Sem armazenamento, o filtro só não volta depois.
    }
  }, [guardarEm, contexto, lidoPara, filtros, ordenacao]);

  // As células de cada linha, calculadas uma vez por lista: a lista do
  // funil passa por todas as linhas em cada coluna, e recalcular a célula
  // a cada passada pesaria nas listas de centenas de títulos. Por isso as
  // colunas precisam ser estáveis: constante do módulo ou `useMemo`.
  const celulas = React.useMemo(
    () => linhas.map((l) => colunas.map((c) => emLista(c.celula(l)))),
    [linhas, colunas],
  );

  const passa = React.useCallback(
    (i: number, exceto: number | null) =>
      colunas.every((c, j) => j === exceto || passaNaColuna(celulas[i][j], filtros[c.chave], !!c.faixa)),
    [colunas, celulas, filtros],
  );

  const valores = React.useMemo(() => {
    return colunas.map((c, j) => {
      if (c.faixa) return [] as ValorDaColuna[];
      const mapa = new Map<string, { rotulo: string; ordem: string | number; quantas: number; grupo?: string }>();
      // A lista do funil segue `ordemNaLista` quando a coluna tem.
      celulas.forEach((linha, i) => {
        if (!passa(i, j)) return;
        // O mesmo valor duas vezes na mesma linha conta uma.
        const vistos = new Set<string>();
        for (const cel of linha[j]) {
          if (vistos.has(cel.valor)) continue;
          vistos.add(cel.valor);
          const atual = mapa.get(cel.valor);
          if (atual) atual.quantas += 1;
          else
            mapa.set(cel.valor, { rotulo: cel.rotulo, ordem: cel.ordemNaLista ?? cel.ordem, quantas: 1, grupo: cel.grupo });
        }
      });
      return [...mapa.entries()]
        .sort(([, a], [, b]) => comparar(a.ordem, b.ordem))
        .map(([valor, x]) => ({ valor, rotulo: x.rotulo, quantas: x.quantas, grupo: x.grupo }));
    });
  }, [colunas, celulas, passa]);

  /** Ordena uma lista qualquer destas linhas pela coluna escolhida — a
   *  tela agrupada usa para os jobs de dentro de cada projeto. */
  const ordenar = React.useCallback(
    (lista: L[]): L[] => {
      if (!ordenacao) return lista;
      const j = colunas.findIndex((c) => c.chave === ordenacao.coluna);
      if (j < 0) return lista;
      const sinal = ordenacao.direcao === "asc" ? 1 : -1;
      const indice = new Map(linhas.map((l, i) => [l, i]));
      return lista
        .map((l, pos) => {
          const i = indice.get(l);
          const cel = i === undefined ? emLista(colunas[j].celula(l)) : celulas[i][j];
          // Célula de vários valores ordena pelo primeiro.
          return { l, pos, chave: cel[0]?.ordem ?? "" };
        })
        .sort((a, b) => comparar(a.chave, b.chave) * sinal || a.pos - b.pos)
        .map((x) => x.l);
    },
    [ordenacao, linhas, colunas, celulas],
  );

  const visiveis = React.useMemo(
    () => ordenar(linhas.filter((_, i) => passa(i, null))),
    [linhas, passa, ordenar],
  );

  const filtrando = colunas.some((c) => filtroAtivo(filtros[c.chave]));

  /** O título que filtra e ordena. `rotulo` troca o nome mostrado (a
   *  coluna "Job" da lista corrida é o filtro do Nome). */
  function titulo(chave: string, className?: string, rotulo?: string) {
    const j = colunas.findIndex((c) => c.chave === chave);
    const c = colunas[j];
    if (!c) return null;
    return (
      <FiltroDeColuna
        rotulo={rotulo ?? c.rotulo}
        tipo={c.tipo}
        faixa={c.faixa}
        valores={valores[j]}
        filtro={filtros[chave] ?? FILTRO_VAZIO}
        onFiltro={(f) => setFiltros((atual) => ({ ...atual, [chave]: f }))}
        ordem={ordenacao?.coluna === chave ? ordenacao.direcao : null}
        onOrdem={(d) => setOrdenacao(d ? { coluna: chave, direcao: d } : null)}
        alinhar={c.alinhar}
        rotuloSemGrupo={c.rotuloSemGrupo ?? (c.tipo === "data" ? "(sem data)" : "(vazio)")}
        className={className}
      />
    );
  }

  function limpar() {
    setFiltros({});
    setOrdenacao(null);
  }

  /** Põe um filtro numa coluna por fora do título (a etiqueta do bloco, na
   *  aba PPs, filtra a Origem pelos itens dele). */
  function definir(chave: string, f: FiltroDaColuna) {
    setFiltros((atual) => ({ ...atual, [chave]: f }));
  }

  return {
    /** As linhas que passam nos filtros dos títulos, já na ordem escolhida. */
    visiveis,
    /** Ordena outra lista destas linhas (os jobs dentro do projeto). */
    ordenar,
    /** Algum título filtra. */
    filtrando,
    /** Algum título filtra ou ordena: é quando a barra aparece. */
    ativo: filtrando || ordenacao !== null,
    ordenacao,
    titulo,
    limpar,
    definir,
    total: linhas.length,
  };
}

/**
 * Quantas linhas os filtros dos títulos deixaram, e o botão que tira todos
 * de uma vez — o mesmo aviso da aba PPs: o filtro mora escondido no título,
 * e é fácil esquecer um ligado.
 */
export function BarraDosFiltrosDeColuna({
  visiveis,
  total,
  singular,
  plural,
  onLimpar,
  className,
}: {
  visiveis: number;
  total: number;
  singular: string;
  plural: string;
  onLimpar: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-[12px] text-muted-foreground",
        className,
      )}
    >
      <span>
        Mostrando <strong className="text-foreground">{visiveis}</strong> de {total} {total === 1 ? singular : plural} ·
        filtros e ordem pelos títulos das colunas
      </span>
      <button
        type="button"
        onClick={onLimpar}
        className="inline-flex items-center gap-1 font-semibold text-california-red hover:underline"
      >
        <X className="h-3.5 w-3.5" />
        Limpar filtros e ordem
      </button>
    </div>
  );
}
