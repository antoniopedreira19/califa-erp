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

/** O filtro de uma coluna. Vazio = a coluna não filtra. */
export interface FiltroDaColuna {
  /** O texto buscado dentro da coluna. */
  busca: string;
  /** Os valores marcados; `null` = todos (a coluna não filtra por lista). */
  marcados: string[] | null;
  /** A faixa da coluna de valor (só no tipo `faixa`). */
  de: number | null;
  ate: number | null;
}

export const FILTRO_VAZIO: FiltroDaColuna = { busca: "", marcados: null, de: null, ate: null };

export function filtroAtivo(f: FiltroDaColuna | undefined): boolean {
  return !!f && (f.busca.trim() !== "" || f.marcados !== null || f.de !== null || f.ate !== null);
}

/** Sem acento e em minúsculas: "Diárias" acha "diarias". */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
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
  className,
}: {
  rotulo: string;
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
  alinhar?: "left" | "right";
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
  const marcado = (v: string) => filtro.marcados === null || filtro.marcados.includes(v);
  const todosMarcados = visiveis.every((v) => marcado(v.valor));

  function alternar(v: string) {
    const atuais = filtro.marcados ?? valores.map((x) => x.valor);
    const proximos = atuais.includes(v) ? atuais.filter((x) => x !== v) : [...atuais, v];
    // Todos marcados de novo = a coluna deixa de filtrar por lista.
    const todos = valores.every((x) => proximos.includes(x.valor));
    onFiltro({ ...filtro, marcados: todos ? null : proximos });
  }

  /** Marca ou desmarca de uma vez os valores de um grupo. */
  function alternarGrupo(grupo: string) {
    const doGrupo = visiveis.filter((v) => (v.grupo ?? "") === grupo).map((v) => v.valor);
    const tudoMarcado = doGrupo.every((v) => marcado(v));
    const atuais = filtro.marcados ?? valores.map((x) => x.valor);
    const proximos = tudoMarcado
      ? atuais.filter((x) => !doGrupo.includes(x))
      : Array.from(new Set([...atuais, ...doGrupo]));
    const todos = valores.every((x) => proximos.includes(x.valor));
    onFiltro({ ...filtro, marcados: todos ? null : proximos });
  }

  function alternarTodos() {
    const atuais = filtro.marcados ?? valores.map((x) => x.valor);
    const doFiltro = visiveis.map((x) => x.valor);
    const proximos = todosMarcados
      ? atuais.filter((x) => !doFiltro.includes(x))
      : Array.from(new Set([...atuais, ...doFiltro]));
    const todos = valores.every((x) => proximos.includes(x.valor));
    onFiltro({ ...filtro, marcados: todos ? null : proximos });
  }

  const [rotuloAsc, rotuloDesc] = ORDENS[tipo];

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filtrar e ordenar por ${rotulo}`}
          className={cn(
            "group inline-flex max-w-full items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground",
            alinhar === "right" && "flex-row-reverse",
            (ativo || ordem) && "text-foreground",
            className,
          )}
        >
          {/* Quebra em duas linhas em vez de cortar: o título é o que diz
              o que a coluna é. */}
          <span className={cn("leading-tight", alinhar === "right" ? "text-right" : "text-left")}>{rotulo}</span>
          <span className={cn("inline-flex flex-none items-center gap-0.5", alinhar === "right" && "flex-row-reverse")}>
            {ordem === "asc" && <ArrowUp className="h-3 w-3" />}
            {ordem === "desc" && <ArrowDown className="h-3 w-3" />}
            {ativo ? (
              <Filter className="h-3 w-3 fill-california-red text-california-red" />
            ) : (
              <ChevronDown className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-80" />
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={alinhar === "right" ? "end" : "start"}
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
                                rotulo={g || "(sem bloco)"}
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
