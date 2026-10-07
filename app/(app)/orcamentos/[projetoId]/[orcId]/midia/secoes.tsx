"use client";

/**
 * A planilha de Mídia Off — um card por meio (decisão 147).
 *
 * Porte do protótipo aprovado pelo Tiago em 06/10/2026 ("Planilha de Mídia
 * Off", v21). Duas formas de compra:
 *   • grade de inserções (TV, rádio): os dias do mês são os títulos das
 *     colunas da PROGRAMAÇÃO, e a soma de inserções por dia fecha o mês;
 *   • período (OOH, DOOH, portais): início e fim, quantidade e períodos.
 * As sete colunas de valor (do Unit. tabela ao Total) têm a MESMA largura
 * em todos os meios e no "Total" — a faixa ORÇADO cai no mesmo lugar em
 * todos, como planilha e Totais na regra de `blocos.ts`.
 *
 * O teclado é o das outras planilhas (decisão 046, `_planilha/selecao.tsx`):
 * clique seleciona, clique de novo abre; setas andam; Enter, F2 ou digitar
 * abre; no campo, Enter desce, Tab anda, Esc cancela. Uma máquina por meio
 * — cada meio é uma tabela. Na programação, arrastar sobre os dias marca
 * vários, também em várias linhas, e o número digitado preenche todos.
 *
 * A grade tem duas larguras ("Caber na tela ⇄ Alargar colunas", um botão só
 * para a tela inteira): na larga, a tabela rola para o lado com Praça e
 * Veículo fixas, e todos os meios e meses rolam juntos.
 */

import * as React from "react";
import { ChevronDown, ChevronsLeftRight, ChevronsRightLeft, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  BOTAO_NOVO_GRUPO,
  ERRATA,
  FAIXA_GRUPO,
  FAIXA_ROTULO,
  LINHA_TOTAL_ROTULO,
  ORCADO,
  SELECAO,
  VEICULACAO,
} from "@/app/(app)/_planilha/blocos";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calha, LinhaDaCalha, usePosicoesDaCalha, type PosicoesCalha } from "@/app/(app)/_planilha/calha";
import {
  DicasDeTeclado,
  useSelecaoPlanilha,
  type CelulaSelecionada,
  type ColunaDaGrade,
  type Selecao as SelecaoDaGrade,
  type TipoEditor,
} from "@/app/(app)/_planilha/selecao";
import { direcaoNoCampo, type Direcao } from "@/app/(app)/_planilha/navegacao";
import {
  contaDaLinha,
  diasDoMes,
  lerNumero,
  nomeDoMesMidia,
  somar,
  type ContaDaLinha,
  type LinhaMidia,
  type MeioDaVersao,
  type ParametrosMidia,
} from "@/lib/calculos/midia-off";
import { EditarMeio, type EdicaoDoMeio } from "./abas";

// ---- Contexto de edição ---------------------------------------------------

/** Um veículo da lista: o fornecedor e os meios que ele vende. */
export interface VeiculoDaLista {
  /** O id do fornecedor. */
  id: string;
  nome: string;
  /** Os meios em que o veículo já foi usado nas planilhas (decisão 150):
   *  vêm do uso, e não do cadastro. */
  meios: string[];
}

export interface ApiDaPlanilha {
  params: ParametrosMidia;
  readOnly: boolean;
  editando: string | null;
  /** A célula em edição AGORA — lida de uma ref, para o blur de um campo
   *  que o Tab acabou de trocar não fechar o campo seguinte. */
  atual: () => string | null;
  setEditando: (k: string | null) => void;
  atualizarLinha: (id: string, patch: Partial<LinhaMidia>) => void;
  removerLinha: (id: string) => void;
  duplicarLinha: (id: string) => void;
  /** As colunas da grade estão largas (rolagem) em todos os meios. */
  gradeLarga: boolean;
  alternarGradeLarga: () => void;
  /** O meio ("TV Fechada") e o mês ("2026-07") do grupo da linha. */
  meioDoGrupo: (grupoId: string) => string;
  mesDoGrupo: (grupoId: string) => string;
  /** O caractere que abriu a célula pelo teclado (decisão 046): o campo
   *  nasce com ele no lugar do valor. */
  semente: { chave: string; texto: string } | null;
  abrirCampo: (chave: string, semente?: string) => void;
  selecao: SelecaoDeDias | null;
  iniciarSelecao: (s: SelecaoDeDias) => void;
  estenderSelecao: (linhaIdx: number, dia: number) => void;
  /** Texto inicial do campo de preenchimento da seleção, ou null. */
  preenchendo: string | null;
  preencher: (n: number) => void;
  fecharPreenchimento: () => void;
  veiculos: VeiculoDaLista[];
  /** Abre o cadastro: novo (com o nome da busca) ou a edição do escolhido. */
  abrirVeiculo: (linhaId: string, nomeInicial?: string) => void;
}

/** A seleção de dias da grade: um retângulo dentro de UM meio de UM mês —
 *  das linhas l0..l1 (posição no mês) e dos dias d0..d1. */
export interface SelecaoDeDias {
  grupoId: string;
  mes: string;
  linhaIds: string[];
  l0: number;
  l1: number;
  d0: number;
  d1: number;
}

function dentroDaSelecao(s: SelecaoDeDias | null, grupoId: string, idx: number, dia: number): boolean {
  if (!s || s.grupoId !== grupoId) return false;
  return (
    idx >= Math.min(s.l0, s.l1) &&
    idx <= Math.max(s.l0, s.l1) &&
    dia >= Math.min(s.d0, s.d1) &&
    dia <= Math.max(s.d0, s.d1)
  );
}

const Ctx = React.createContext<ApiDaPlanilha | null>(null);
function useApi(): ApiDaPlanilha {
  const a = React.useContext(Ctx);
  if (!a) throw new Error("Planilha de mídia fora do provedor");
  return a;
}

export function ProvedorDaPlanilha({ valor, children }: { valor: ApiDaPlanilha; children: React.ReactNode }) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

// ---- Formatação -----------------------------------------------------------

export function brl(v: number): string {
  return formatCurrency(v, "BRL");
}
function inteiro(v: number): string {
  return Math.round(v).toLocaleString("pt-BR");
}
function formatarPct(n: number): string {
  return String(Number(n.toFixed(2))).replace(".", ",");
}

// ---- Larguras -------------------------------------------------------------

/** Unit. tabela, Desc., Unit. negociado, Total negociado, Veículo,
 *  Honorários, Total. Iguais em todos os meios. As ações da linha moram na
 *  calha, fora da tabela; quem envolve os meios reserva com `PR_CALHA_MIDIA`. */
const LARG_VALOR = [100, 40, 100, 110, 106, 98, 110];

function ColsValor() {
  return (
    <>
      {LARG_VALOR.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </>
  );
}

function CabecalhosValor() {
  const api = useApi();
  const th = "text-right font-semibold px-1.5 py-2 leading-tight whitespace-normal";
  return (
    <>
      <th className={cn(th, ORCADO.cabecalhoAbre)}>Unit. tabela</th>
      <th className={cn(th, ORCADO.cabecalhoMeio)}>Desc.</th>
      <th className={cn(th, ORCADO.cabecalhoMeio)}>Unit. negociado</th>
      <th className={cn(th, ORCADO.cabecalhoMeio)}>Total negociado</th>
      <th className={cn(th, ORCADO.cabecalhoMeio)}>
        Veículo <span className="font-mono normal-case">{formatarPct(api.params.veiculo)}%</span>
      </th>
      <th className={cn(th, ORCADO.cabecalhoMeio)}>
        Honorários <span className="font-mono normal-case">{formatarPct(api.params.honorarios)}%</span>
      </th>
      <th className={cn(th, ORCADO.cabecalhoFim)}>Total</th>
    </>
  );
}

// ---- Células editáveis ----------------------------------------------------

type Tipo = "texto" | "moeda" | "pct" | "inteiro";

/** O campo aberto de uma célula. Nasce com o texto atual JÁ no estado e
 *  selecionado: digitar substitui o valor. */
function CampoAberto({
  chave,
  inicial,
  onGravar,
  proxima,
  anterior,
  setas,
  filtro,
  inputMode,
  className,
}: {
  chave: string;
  inicial: string;
  onGravar: (texto: string) => void;
  /** Tab (e seta → com `setas`) abre esta célula em seguida. */
  proxima?: string | null;
  /** Shift+Tab (e seta ←) abre esta. */
  anterior?: string | null;
  setas?: boolean;
  filtro?: (t: string) => string;
  inputMode?: "decimal" | "numeric";
  className: string;
}) {
  const api = useApi();
  const nav = React.useContext(NavCtx);
  // Aberta pelo teclado com um caractere: ele substitui o valor, e o cursor
  // fica depois dele.
  const comSemente = api.semente?.chave === chave;
  const [texto, setTexto] = React.useState(comSemente ? api.semente!.texto : inicial);
  const gravou = React.useRef(false);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (comSemente) el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function gravar() {
    if (gravou.current) return;
    gravou.current = true;
    onGravar(texto);
  }

  return (
    <input
      ref={ref}
      value={texto}
      onChange={(e) => setTexto(filtro ? filtro(e.target.value) : e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Num meio, as teclas são as das outras planilhas: Enter desce, Tab
        // anda, ↑ ↓ sempre e ← → na borda do texto; Esc cancela.
        if (nav) {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            gravou.current = true;
            nav.cancelar();
            return;
          }
          const d = direcaoNoCampo(e, e.currentTarget);
          if (d) {
            e.preventDefault();
            gravar();
            nav.fecharEMover(chave, d);
          }
          return;
        }
        const voltar = (e.key === "Tab" && e.shiftKey) || (setas && e.key === "ArrowLeft");
        const avancar = (e.key === "Tab" && !e.shiftKey) || (setas && e.key === "ArrowRight");
        if (e.key === "Enter") {
          e.preventDefault();
          gravar();
          api.setEditando(null);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          gravou.current = true;
          api.setEditando(null);
        } else if (voltar || avancar) {
          e.preventDefault();
          gravar();
          api.setEditando((voltar ? anterior : proxima) ?? null);
        }
      }}
      onBlur={() => {
        gravar();
        if (api.atual() === chave) api.setEditando(null);
      }}
      inputMode={inputMode}
      className={className}
    />
  );
}

function Editavel({
  chave,
  valor,
  tipo,
  onSalvar,
  placeholder,
  className,
  exibir,
  quebra,
}: {
  chave: string;
  valor: string | number;
  tipo: Tipo;
  onSalvar: (v: string | number) => void;
  placeholder?: string;
  className?: string;
  /** O que a célula mostra fora da edição. */
  exibir?: React.ReactNode;
  /** Texto longo (ponto de OOH) quebra em até duas linhas em vez de cortar. */
  quebra?: boolean;
}) {
  const api = useApi();
  const nav = React.useContext(NavCtx);
  const ativo = api.editando === chave;

  if (ativo) {
    const inicial =
      tipo === "texto"
        ? String(valor ?? "")
        : tipo === "pct"
          ? Number(valor)
            ? formatarPct(Number(valor) * 100)
            : ""
          : tipo === "moeda"
            ? Number(valor)
              ? Number(valor).toFixed(2).replace(".", ",")
              : ""
            : Number(valor)
              ? String(valor)
              : "";
    return (
      <CampoAberto
        chave={chave}
        inicial={inicial}
        inputMode={tipo === "texto" ? undefined : "decimal"}
        className={tipo === "texto" ? ERRATA.inputNome : ERRATA.input}
        onGravar={(t) => {
          if (tipo === "texto") return onSalvar(t.trim());
          const n = lerNumero(t);
          if (tipo === "pct") onSalvar(Math.max(0, Math.min(100, n ?? 0)) / 100);
          else onSalvar(Math.max(0, n ?? 0));
        }}
      />
    );
  }

  const vazio = valor === "" || valor === null || valor === undefined;
  return (
    <div
      role={api.readOnly || nav ? undefined : "button"}
      tabIndex={api.readOnly || nav ? undefined : -1}
      onClick={
        nav
          ? undefined
          : (e) => {
              e.stopPropagation();
              if (!api.readOnly) api.setEditando(chave);
            }
      }
      className={cn(
        "min-h-[18px] rounded-[5px]",
        quebra ? "line-clamp-2 whitespace-normal leading-snug" : "truncate",
        !api.readOnly && !nav && "cursor-text hover:bg-black/[0.035]",
        className,
      )}
      title={tipo === "texto" && typeof valor === "string" && valor.length > 24 ? valor : undefined}
    >
      {vazio && placeholder ? <span className="italic text-muted-foreground/60">{placeholder}</span> : (exibir ?? valor)}
    </div>
  );
}

/** A célula de um dia da grade. O campo aberto é mais largo que a coluna:
 *  ele flutua por cima da célula enquanto se digita. Arrastar marca vários
 *  dias (e várias linhas), e o número digitado preenche todos. */
function Dia({
  linha,
  dia,
  fimDeSemana,
  ultimoDia,
  idx,
  linhaIds,
  grupoId,
  mes,
}: {
  linha: LinhaMidia;
  dia: number;
  fimDeSemana: boolean;
  ultimoDia: number;
  idx: number;
  linhaIds: string[];
  grupoId: string;
  mes: string;
}) {
  const api = useApi();
  const nav = React.useContext(NavCtx);
  const chave = `${linha.id}:dia:${dia}`;
  const ativo = api.editando === chave;
  const valor = linha.dias[dia] ?? 0;
  const navProps = nav?.selecao.celulaProps(linha.id, `dia:${dia}`);
  const selecionado = nav?.selecao.estaSelecionada(linha.id, `dia:${dia}`) ?? false;

  const vizinho = (d: number) => (d >= 1 && d <= ultimoDia ? `${linha.id}:dia:${d}` : null);
  const marcado = dentroDaSelecao(api.selecao, grupoId, idx, dia);
  const fimDaSelecao =
    !!api.selecao && api.selecao.grupoId === grupoId && api.selecao.l1 === idx && api.selecao.d1 === dia;

  return (
    <td
      data-dia="1"
      // A seleção do sistema (decisão 046): clique seleciona, clique de
      // novo abre, digitar abre com o número. Arrastar marca vários dias.
      data-cel={navProps?.["data-cel"]}
      onClick={navProps?.onClick}
      onDoubleClick={navProps?.onDoubleClick}
      className={cn(
        "relative select-none p-0 text-center font-mono text-[10px] leading-none",
        VEICULACAO.dia,
        fimDeSemana && VEICULACAO.diaFimDeSemana,
        !api.readOnly && cn("cursor-cell", VEICULACAO.diaHover),
        marcado && VEICULACAO.diaMarcado,
        selecionado && !ativo && VEICULACAO.diaSelecionado,
      )}
      onPointerDown={
        !api.readOnly
          ? (e) => {
              if (e.button !== 0) return;
              // Começar a marcar dias tira a seleção da célula: as teclas
              // passam a ser do preenchimento.
              nav?.selecao.selecionar(null);
              api.iniciarSelecao({ grupoId, mes, linhaIds, l0: idx, l1: idx, d0: dia, d1: dia });
            }
          : undefined
      }
      onPointerEnter={() => api.estenderSelecao(idx, dia)}
      title={`Dia ${dia}`}
    >
      <span className={cn(valor ? "font-bold text-foreground" : "text-transparent")}>{valor || "·"}</span>
      {ativo && (
        <CampoAberto
          chave={chave}
          inicial={valor ? String(valor) : ""}
          proxima={vizinho(dia + 1)}
          anterior={vizinho(dia - 1)}
          setas
          filtro={(t) => t.replace(/\D/g, "")}
          inputMode="numeric"
          className="absolute left-1/2 top-1/2 z-20 h-7 w-9 -translate-x-1/2 -translate-y-1/2 rounded-md border border-california-red bg-white text-center font-mono text-[12px] font-bold text-foreground shadow-[0_0_0_3px_rgba(231,75,86,.22)] outline-none"
          onGravar={(t) => {
            const n = Math.max(0, Math.round(lerNumero(t) ?? 0));
            const dias = { ...linha.dias };
            if (n > 0) dias[dia] = n;
            else delete dias[dia];
            api.atualizarLinha(linha.id, { dias });
          }}
        />
      )}
      {fimDaSelecao && api.preenchendo !== null && (
        <CampoPreencher
          // Enter ou Esc: a seleção do teclado volta no dia onde o arrasto
          // terminou, e as setas seguem dali.
          aoTerminar={() => {
            nav?.selecao.selecionar({ linhaId: linha.id, coluna: `dia:${dia}` });
            setTimeout(() => nav?.selecao.focar(), 0);
          }}
        />
      )}
    </td>
  );
}

/** O campo que preenche a seleção inteira. Nasce com o dígito que o abriu,
 *  com o cursor no fim (o segundo dígito emenda: "1", "2" → 12). */
function CampoPreencher({ aoTerminar }: { aoTerminar: () => void }) {
  const api = useApi();
  const [texto, setTexto] = React.useState(api.preenchendo ?? "");
  const gravou = React.useRef(false);
  const ref = React.useRef<HTMLInputElement>(null);
  const s = api.selecao;
  const nDias = s ? Math.abs(s.d1 - s.d0) + 1 : 0;
  const nLinhas = s ? Math.abs(s.l1 - s.l0) + 1 : 0;
  const rotulo = `${nDias} ${nDias === 1 ? "dia" : "dias"}${nLinhas > 1 ? ` × ${nLinhas} linhas` : ""} · Enter`;

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  function gravar() {
    if (gravou.current) return;
    gravou.current = true;
    api.preencher(Math.max(0, Math.round(lerNumero(texto) ?? 0)));
  }

  return (
    <span className="absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5">
      <input
        ref={ref}
        value={texto}
        onChange={(e) => setTexto(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            gravar();
            aoTerminar();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            gravou.current = true;
            api.fecharPreenchimento();
            aoTerminar();
          }
        }}
        onBlur={gravar}
        inputMode="numeric"
        aria-label="Inserções nos dias marcados"
        className="h-7 w-10 rounded-md border border-california-red bg-white text-center font-mono text-[12px] font-bold text-foreground shadow-[0_0_0_3px_rgba(231,75,86,.22)] outline-none"
      />
      <span className="whitespace-nowrap rounded-md bg-foreground px-1.5 py-1 font-sans text-[10.5px] font-semibold text-white">
        {rotulo}
      </span>
    </span>
  );
}

// ---- Navegação por teclado (decisão 046) ---------------------------------

interface Nav {
  selecao: SelecaoDaGrade;
  /** Fecha o campo aberto e anda a seleção. */
  fecharEMover: (chave: string, destino?: Direcao) => void;
  /** Esc: fecha sem gravar e devolve o foco à tabela. */
  cancelar: () => void;
  /** Depois de escolher numa lista (veículo, tipo, data): a célula fica
   *  selecionada e as setas voltam a andar. */
  depoisDaLista: (linhaId: string, coluna: string) => void;
  /** Handlers do card: o foco que o Radix devolve ao gatilho da lista
   *  fechada sem escolha (Esc, clique fora) volta ao card. */
  card: {
    onPointerDownCapture: () => void;
    onFocus: (e: React.FocusEvent) => void;
  };
}
const NavCtx = React.createContext<Nav | null>(null);

function separar(chave: string): CelulaSelecionada {
  const i = chave.indexOf(":");
  return { linhaId: chave.slice(0, i), coluna: chave.slice(i + 1) };
}

/** O que cada coluna abre. Ausente = calculada: seleciona, não abre. */
const EDITOR: Record<string, TipoEditor> = {
  praca: "texto",
  descricao: "texto",
  formato: "texto",
  veiculo: "lista",
  tipo: "lista",
  inicio: "lista",
  fim: "lista",
  unitTabela: "numero",
  desconto: "numero",
  unitNegociado: "numero",
  qtde: "numero",
  periodos: "numero",
};

const COLUNAS_VALOR: ColunaDaGrade[] = [
  { chave: "unitTabela", rotulo: "Unit. tabela", bloco: "Orçado" },
  { chave: "desconto", rotulo: "Desc.", bloco: "Orçado" },
  { chave: "unitNegociado", rotulo: "Unit. negociado", bloco: "Orçado" },
  { chave: "totalNegociado", rotulo: "Total negociado", bloco: "Orçado" },
  { chave: "notaVeiculo", rotulo: "Veículo", bloco: "Orçado" },
  { chave: "notaAgencia", rotulo: "Honorários", bloco: "Orçado" },
  { chave: "total", rotulo: "Total", bloco: "Orçado" },
];

function useNavDoMeio(
  linhasIds: string[],
  colunas: ColunaDaGrade[],
  wrapperRef: React.RefObject<HTMLDivElement | null>,
): Nav {
  const api = useApi();
  const editorDe = React.useCallback(
    (_linhaId: string, coluna: string): TipoEditor | null => {
      if (api.readOnly) return null;
      if (coluna.startsWith("dia:")) return "numero";
      return EDITOR[coluna] ?? null;
    },
    [api.readOnly],
  );
  const editandoAqui = api.editando !== null && linhasIds.some((id) => api.editando!.startsWith(`${id}:`));
  const apontando = React.useRef(false);
  const selecao = useSelecaoPlanilha({
    linhas: linhasIds,
    colunas,
    editorDe,
    onAbrir: (c, semente) => {
      if (editorDe(c.linhaId, c.coluna) === "lista") {
        // As listas do sistema (Combobox, Select, DatePicker) abrem pelo
        // próprio gatilho — o mesmo que o clique faria.
        const td = wrapperRef.current?.querySelector(`[data-cel="${c.linhaId}:${c.coluna}"]`);
        const gatilho = td?.querySelector<HTMLElement>("button");
        if (!gatilho) return;
        if (c.coluna === "tipo")
          gatilho.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
        else gatilho.click();
        return;
      }
      api.abrirCampo(`${c.linhaId}:${c.coluna}`, semente);
    },
    editando: editandoAqui,
    wrapperRef,
  });
  return {
    selecao,
    fecharEMover: (chave, destino) => {
      api.setEditando(null);
      if (destino) selecao.mover(destino, separar(chave));
      setTimeout(() => selecao.focar(), 0);
    },
    cancelar: () => {
      api.setEditando(null);
      setTimeout(() => selecao.focar(), 0);
    },
    depoisDaLista: (linhaId, coluna) => {
      selecao.selecionar({ linhaId, coluna });
      setTimeout(() => selecao.focar(), 0);
    },
    card: {
      onPointerDownCapture: () => {
        apontando.current = true;
        setTimeout(() => (apontando.current = false), 300);
      },
      onFocus: (e) => {
        // Clique no gatilho é do mouse e abre a lista: fica como está. Foco
        // que chega sem clique é o Radix devolvendo o gatilho depois de a
        // lista fechar — as setas são do card, não do botão.
        if (apontando.current || e.target === e.currentTarget) return;
        const td = (e.target as Element).closest<HTMLElement>("[data-cel]");
        if (!td || (e.target as Element).tagName !== "BUTTON") return;
        selecao.focar();
      },
    },
  };
}

/** Uma célula navegável: os handlers da seleção no `<td>` e a moldura no
 *  miolo, como o `Miolo` das outras planilhas. */
function Cel({
  linhaId,
  coluna,
  className,
  miolo,
  children,
}: {
  linhaId: string;
  coluna: string;
  className?: string;
  miolo?: string;
  children: React.ReactNode;
}) {
  const nav = React.useContext(NavCtx);
  const p = nav?.selecao.celulaProps(linhaId, coluna);
  return (
    <td {...(p ?? {})} className={cn(className, p?.className)}>
      <div className={cn("min-w-0", miolo, nav?.selecao.moldura(linhaId, coluna))}>{children}</div>
    </td>
  );
}

/** As dicas de teclado, uma vez embaixo dos meios — as mesmas das outras
 *  planilhas, mais a da programação. */
export function DicasDaPlanilha() {
  const api = useApi();
  return (
    <div>
      <DicasDeTeclado editavel={!api.readOnly} />
      {!api.readOnly && (
        <p className={cn(SELECAO.dicas, "mt-1")}>
          <span>Na programação: arraste sobre os dias para marcar vários, também em várias linhas, e digite o número</span>
          <span>
            · <span className={SELECAO.tecla}>Delete</span> apaga
          </span>
          <span>
            · <span className={SELECAO.tecla}>Esc</span> desmarca
          </span>
        </p>
      )}
      {api.gradeLarga && (
        <p className={cn(SELECAO.dicas, "mt-1")}>
          <span>
            Na TV e no rádio, a planilha rola para o lado: trackpad, <span className={SELECAO.tecla}>Shift</span> + roda do
            mouse ou a barra no pé do meio. Praça e Veículo ficam fixas. <span className={SELECAO.tecla}>Caber na tela</span>,
            abaixo da barra de meios, volta às colunas estreitas
          </span>
        </p>
      )}
    </div>
  );
}

// ---- Células de valor da linha -------------------------------------------

function CelulasValor({ linha, conta }: { linha: LinhaMidia; conta: ContaDaLinha }) {
  const api = useApi();
  const td = "px-1.5 py-1.5 text-right align-top whitespace-nowrap font-mono text-[11px]";
  const k = (c: string) => `${linha.id}:${c}`;
  return (
    <>
      <Cel linhaId={linha.id} coluna="unitTabela" className={cn(td, ORCADO.celulaAbre)}>
        <Editavel
          chave={k("unitTabela")}
          valor={linha.unitTabela}
          tipo="moeda"
          exibir={linha.unitTabela ? brl(linha.unitTabela) : <span className="text-muted-foreground/50">—</span>}
          onSalvar={(v) => {
            const unitTabela = Number(v);
            api.atualizarLinha(linha.id, { unitTabela, unitNegociado: unitTabela * (1 - linha.desconto) });
          }}
        />
      </Cel>
      <Cel linhaId={linha.id} coluna="desconto" className={cn(td, ORCADO.celulaMeio)}>
        <Editavel
          chave={k("desconto")}
          valor={linha.desconto}
          tipo="pct"
          exibir={<span className={cn(!linha.desconto && "text-muted-foreground/60")}>{formatarPct(linha.desconto * 100)}%</span>}
          onSalvar={(v) => {
            const desconto = Number(v);
            api.atualizarLinha(linha.id, { desconto, unitNegociado: linha.unitTabela * (1 - desconto) });
          }}
        />
      </Cel>
      <Cel linhaId={linha.id} coluna="unitNegociado" className={cn(td, ORCADO.celulaMeio)}>
        <Editavel
          chave={k("unitNegociado")}
          valor={linha.unitNegociado}
          tipo="moeda"
          exibir={linha.unitNegociado ? brl(linha.unitNegociado) : <span className="text-muted-foreground/50">—</span>}
          onSalvar={(v) => {
            const unitNegociado = Number(v);
            // Digitar o negociado recalcula o desconto — as duas pontas da
            // mesma conta.
            const desconto = linha.unitTabela > 0 ? Math.max(0, 1 - unitNegociado / linha.unitTabela) : 0;
            api.atualizarLinha(linha.id, { unitNegociado, desconto });
          }}
        />
      </Cel>
      <Cel linhaId={linha.id} coluna="totalNegociado" className={cn(td, ORCADO.celulaMeio, "font-semibold")}>
        {brl(conta.totalNegociado)}
      </Cel>
      <Cel linhaId={linha.id} coluna="notaVeiculo" className={cn(td, ORCADO.celulaMeio, "text-muted-foreground")}>
        {brl(conta.notaVeiculo)}
      </Cel>
      <Cel linhaId={linha.id} coluna="notaAgencia" className={cn(td, ORCADO.celulaMeio, "text-muted-foreground")}>
        {brl(conta.notaAgencia)}
      </Cel>
      <Cel linhaId={linha.id} coluna="total" className={cn(td, ORCADO.celulaTotal, "font-semibold")}>
        {brl(conta.total)}
      </Cel>
    </>
  );
}

/** O tipo da linha (resposta 2 do Tiago, 04/10/2026: quem emite a nota do
 *  veículo se decide linha a linha). São os MESMOS A · Direto e A · Repasse
 *  do nacional. Na tabela, só a sigla. */
const TIPOS_DA_LINHA = [
  { value: "A", rotulo: "A · Direto" },
  { value: "AR", rotulo: "A · Repasse" },
] as const;

function CelulaTipo({ linha }: { linha: LinhaMidia }) {
  const api = useApi();
  const nav = React.useContext(NavCtx);
  const [aberta, setAberta] = React.useState(false);
  return (
    <Cel linhaId={linha.id} coluna="tipo" className="px-1 py-1 align-top">
      <Select
        value={linha.tipo}
        open={aberta}
        onOpenChange={setAberta}
        onValueChange={(v) => {
          api.atualizarLinha(linha.id, { tipo: v as "A" | "AR" });
          nav?.depoisDaLista(linha.id, "tipo");
        }}
        disabled={api.readOnly}
      >
        <SelectTrigger
          aria-label="Tipo de custo da linha"
          title={linha.tipo === "AR" ? "A · Repasse: a nota do veículo passa pela California" : "A · Direto: o veículo fatura direto ao cliente"}
          className="h-6 w-full justify-start gap-1 rounded-md border-transparent bg-transparent px-1 py-0 shadow-none hover:border-border hover:bg-white focus:ring-0 focus:ring-offset-0 [&>svg]:hidden"
        >
          <SelectValue>
            <Badge variant="outline" className="px-1">
              {linha.tipo}
            </Badge>
          </SelectValue>
        </SelectTrigger>
        {/* Tab com a lista aberta atravessa sem escolher, como no Tipo do
            nacional (decisão 046). */}
        <SelectContent
          onKeyDown={(e) => {
            if (e.key !== "Tab" || !nav) return;
            e.preventDefault();
            setAberta(false);
            nav.selecao.mover(e.shiftKey ? "anterior" : "proxima", { linhaId: linha.id, coluna: "tipo" });
          }}
        >
          {TIPOS_DA_LINHA.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Cel>
  );
}

/** O veículo da linha, do cadastro de veículos. Como o campo de fornecedor
 *  da PP: ao passar o mouse aparece o "+" (cadastrar) ou o lápis (editar o
 *  escolhido), e a busca sem resultado oferece o cadastro com o nome
 *  digitado. A lista mostra primeiro os veículos já usados no meio da linha
 *  (em qualquer planilha), depois os outros (decisão 150). */
function CelulaVeiculo({ linha, className }: { linha: LinhaMidia; className: string }) {
  const api = useApi();
  const nav = React.useContext(NavCtx);
  const meioDaLinha = api.meioDoGrupo(linha.grupoId);
  const itens = React.useMemo(() => {
    const item = (v: VeiculoDaLista, grupo: string) => ({
      value: v.id,
      label: v.nome,
      descricao: v.meios.length ? `Já usado em ${v.meios.join(", ")}` : "Ainda não usado",
      grupo,
    });
    const doMeio = api.veiculos.filter((v) => v.meios.includes(meioDaLinha));
    const outros = api.veiculos.filter((v) => !v.meios.includes(meioDaLinha));
    return [
      ...doMeio.map((v) => item(v, `Já usados em ${meioDaLinha}`)),
      ...outros.map((v) => item(v, "Outros veículos")),
    ];
  }, [api.veiculos, meioDaLinha]);
  const naLista = linha.veiculoId !== null && api.veiculos.some((v) => v.id === linha.veiculoId);
  // Resposta do Tiago (04/10/2026, opção b): a linha pode ficar sem veículo
  // no rascunho, mas a versão só aprova com todas preenchidas. A célula
  // vazia avisa; quem trava é a barra de aprovação.
  const vazio = !naLista;
  return (
    <Cel linhaId={linha.id} coluna="veiculo" className={cn("group/veiculo relative py-1", className)}>
      <Combobox
        items={itens}
        value={naLista ? linha.veiculoId : null}
        onChange={(v) => {
          api.atualizarLinha(linha.id, { veiculoId: v });
          nav?.depoisDaLista(linha.id, "veiculo");
        }}
        // "Escolher veículo" cortava na coluna: o título já diz o quê.
        placeholder="Escolher"
        buscaPlaceholder="Buscar veículo..."
        larguraLista="w-[280px]"
        disabled={api.readOnly}
        acaoSemResultado={
          api.readOnly
            ? undefined
            : { rotulo: (b) => `Cadastrar “${b}” como novo veículo`, onClick: (b) => api.abrirVeiculo(linha.id, b) }
        }
        className={cn(
          "h-6 rounded-md border-transparent bg-transparent px-1 py-0 text-[11.5px] font-medium shadow-none ring-offset-0 hover:border-border hover:bg-white focus:ring-0 focus:ring-offset-0 [&_svg]:hidden",
          vazio && !api.readOnly && "border-dashed border-california-red/40 [&>span:first-child]:text-california-red",
        )}
      />
      {!api.readOnly && (
        <button
          type="button"
          onClick={() => api.abrirVeiculo(linha.id)}
          title={naLista ? "Editar cadastro do veículo" : "Cadastrar veículo"}
          aria-label={naLista ? "Editar cadastro do veículo" : "Cadastrar veículo"}
          className="absolute right-0.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-white text-california-red opacity-0 shadow-sm transition-opacity hover:border-california-red/40 hover:bg-california-red/[0.06] focus-visible:opacity-100 group-hover/veiculo:opacity-100"
        >
          {naLista ? <Pencil className="h-3 w-3" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      )}
    </Cel>
  );
}

/** Data da linha por período: o seletor de data do sistema, enxuto para
 *  caber na célula — só a data, sem o ícone e sem o ✕. */
const DATA_NA_CELULA =
  "h-7 justify-start rounded-md border-transparent bg-transparent px-1.5 py-0 text-[11.5px] hover:border-border hover:bg-white [&_svg]:hidden [&>span+span]:hidden";

/** Date → "AAAA-MM-DD" no fuso local (sem `toISOString`, que é UTC e
 *  voltaria um dia em fuso negativo). */
function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CelulasDatas({ linha }: { linha: LinhaMidia }) {
  const api = useApi();
  const nav = React.useContext(NavCtx);
  const mes = api.mesDoGrupo(linha.grupoId);
  const td = cn("px-1 py-1 align-top text-[11.5px]", VEICULACAO.celula);
  return (
    <>
      <Cel linhaId={linha.id} coluna="inicio" className={td}>
        <DatePicker
          key={`${linha.id}-inicio-${linha.inicio ?? ""}`}
          name={`inicio-${linha.id}`}
          defaultValue={linha.inicio ?? undefined}
          placeholder="Início"
          disabled={api.readOnly}
          // A linha mora no mês em que foi lançada: o início fica nele.
          dateDisabled={mes ? (d) => isoDe(d).slice(0, 7) !== mes : undefined}
          onDateChange={(d) => {
            api.atualizarLinha(linha.id, { inicio: d ? isoDe(d) : null });
            nav?.depoisDaLista(linha.id, "inicio");
          }}
          className={DATA_NA_CELULA}
        />
      </Cel>
      <Cel linhaId={linha.id} coluna="fim" className={td}>
        <DatePicker
          key={`${linha.id}-fim-${linha.fim ?? ""}`}
          name={`fim-${linha.id}`}
          defaultValue={linha.fim ?? undefined}
          placeholder="Fim"
          disabled={api.readOnly}
          dateDisabled={linha.inicio ? (d) => isoDe(d) < linha.inicio! : undefined}
          onDateChange={(d) => {
            api.atualizarLinha(linha.id, { fim: d ? isoDe(d) : null });
            nav?.depoisDaLista(linha.id, "fim");
          }}
          className={DATA_NA_CELULA}
        />
      </Cel>
    </>
  );
}

function SubtotalValor({ conta }: { conta: ContaDaLinha }) {
  const td = "px-1.5 py-2 text-right whitespace-nowrap font-mono text-[11.5px] font-bold";
  const desc = conta.totalTabela > 0 ? (1 - conta.totalNegociado / conta.totalTabela) * 100 : 0;
  return (
    <>
      <td className={ORCADO.subtotalVazio} />
      <td className={cn(td, ORCADO.subtotalValor, "text-[10.5px] font-semibold")} title="Desconto médio sobre a tabela">
        {conta.totalTabela > 0 ? `${desc.toFixed(0)}%` : ""}
      </td>
      <td className={ORCADO.subtotalValor} />
      <td className={cn(td, ORCADO.subtotalValor)}>{brl(conta.totalNegociado)}</td>
      <td className={cn(td, ORCADO.subtotalValor, "font-semibold")}>{brl(conta.notaVeiculo)}</td>
      <td className={cn(td, ORCADO.subtotalValor, "font-semibold")}>{brl(conta.notaAgencia)}</td>
      <td className={cn(td, ORCADO.subtotalValor)}>{brl(conta.total)}</td>
    </>
  );
}

// ---- Título do meio (a faixa) --------------------------------------------

function TituloDoMeio({
  meio,
  qtdLinhas,
  aberta,
  onAlternar,
  edicao,
  compacto,
}: {
  meio: MeioDaVersao;
  qtdLinhas: number;
  aberta: boolean;
  onAlternar: () => void;
  /** O lápis: meio e formato editáveis depois da criação. */
  edicao?: EdicaoDoMeio;
  /** Grade larga: o título fixo tem só a largura de Praça e Veículo; a
   *  contagem de linhas sai (ela está no número da aba). */
  compacto?: boolean;
}) {
  const api = useApi();
  return (
    <div className="flex min-w-0 items-center gap-2.5 normal-case tracking-normal">
      <button
        type="button"
        onClick={onAlternar}
        title={aberta ? "Ocultar as linhas do meio" : "Mostrar as linhas do meio"}
        aria-expanded={aberta}
        className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-california-red"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", !aberta && "-rotate-90")} />
      </button>
      <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-foreground">{meio.meio}</span>
      <span className="flex-none rounded-md border border-border bg-muted/50 px-1.5 py-px font-mono text-[10.5px] font-semibold text-foreground/80">
        {meio.formato}
      </span>
      {edicao && !api.readOnly && <EditarMeio meio={meio} edicao={edicao} />}
      {!compacto && (
        <span className="flex-none whitespace-nowrap text-[11px] font-normal text-muted-foreground">
          {qtdLinhas} {qtdLinhas === 1 ? "linha" : "linhas"}
          {!aberta && qtdLinhas > 0 && " ocultas"}
        </span>
      )}
    </div>
  );
}

function LinhaDeAcao({ colSpan, children, fixa }: { colSpan: number; children: React.ReactNode; fixa?: boolean }) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn(ERRATA.linhaAcao, "py-1.5")}>
        {/* Na grade larga o botão fica preso à esquerda enquanto a planilha
            rola; w-max deixa o bloco estreito o bastante para ficar. */}
        <div className={cn("flex items-center gap-2", fixa && "sticky left-3 z-[2] w-max")}>{children}</div>
      </td>
    </tr>
  );
}

// ---- A calha: fora da tabela, como no nacional ---------------------------
//
// A lixeira do meio fica na calha, como a do grupo na planilha nacional, e
// toda linha ganha a dela, com o duplicar ao lado. Mesmos componentes da
// planilha nacional (`_planilha/calha.tsx`).

const BOTAO_CALHA =
  "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-50";

/** Largura de UM botão da calha (p-1.5 + ícone de 14px). */
const VAGA_CALHA = "w-[26px]";

/** Reserva da página para a calha da mídia: margem de 8px + duas vagas
 *  (duplicar e lixeira). Quem envolve os meios usa esta classe. */
export const PR_CALHA_MIDIA = "pr-[64px]";

function LixeiraDaLinha({ linha, meio }: { linha: LinhaMidia; meio: string }) {
  const api = useApi();
  const [perguntando, setPerguntando] = React.useState(false);
  const veiculo = api.veiculos.find((v) => v.id === linha.veiculoId)?.nome;
  const nome = [veiculo, linha.descricao].filter(Boolean).join(" · ") || "A linha";
  return (
    <>
      <button type="button" onClick={() => setPerguntando(true)} title={`Remover ${nome}`} className={BOTAO_CALHA}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <ConfirmDialog
        open={perguntando}
        onOpenChange={setPerguntando}
        title="Remover linha?"
        description={
          <>
            <strong className="text-foreground">{nome}</strong> será removida de{" "}
            <strong className="text-foreground">{meio}</strong>. Você pode adicionar novamente depois se precisar.
          </>
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        onConfirm={() => {
          setPerguntando(false);
          api.removerLinha(linha.id);
        }}
      />
    </>
  );
}

function LixeiraDoMeio({
  meio,
  qtdLinhas,
  onRemover,
  mesNome,
}: {
  meio: MeioDaVersao;
  qtdLinhas: number;
  onRemover: () => void;
  /** O meio sai só deste mês ("julho"). */
  mesNome: string;
}) {
  const [perguntando, setPerguntando] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setPerguntando(true)}
        title={`Remover ${meio.meio} de ${mesNome}`}
        className={BOTAO_CALHA}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <ConfirmDialog
        open={perguntando}
        onOpenChange={setPerguntando}
        title={`Remover meio de ${mesNome}?`}
        description={
          qtdLinhas > 0 ? (
            <>
              O meio <strong className="text-foreground">{meio.meio}</strong> e{" "}
              {qtdLinhas === 1 ? "a linha" : `as ${qtdLinhas} linhas`} dele em {mesNome} saem da planilha. Essa
              ação não pode ser desfeita.
            </>
          ) : (
            <>
              Remover <strong className="text-foreground">{meio.meio}</strong> de {mesNome}? O meio está vazio e
              essa ação não pode ser desfeita.
            </>
          )
        }
        confirmLabel={qtdLinhas > 0 ? `Remover meio e ${qtdLinhas} ${qtdLinhas === 1 ? "linha" : "linhas"}` : "Remover"}
        cancelLabel="Voltar"
        variant="destructive"
        onConfirm={() => {
          setPerguntando(false);
          onRemover();
        }}
      />
    </>
  );
}

/** As pílulas de um meio. A vaga do "duplicar" fica vazia na faixa do meio
 *  para as lixeiras caírem todas no mesmo eixo. */
function CalhaDoMeio({
  posicoes,
  meio,
  grupoId,
  linhas,
  onRemover,
  mesNome,
}: {
  posicoes: PosicoesCalha;
  meio: MeioDaVersao;
  grupoId: string;
  linhas: LinhaMidia[];
  onRemover?: () => void;
  mesNome: string;
}) {
  const api = useApi();
  if (api.readOnly) return null;
  return (
    <Calha>
      {onRemover && (
        <LinhaDaCalha posicao={posicoes[`g:${grupoId}`]}>
          <span className={cn("flex-none", VAGA_CALHA)} aria-hidden />
          <LixeiraDoMeio meio={meio} qtdLinhas={linhas.length} onRemover={onRemover} mesNome={mesNome} />
        </LinhaDaCalha>
      )}
      {linhas.map((l) => (
        <LinhaDaCalha key={l.id} posicao={posicoes[`l:${l.id}`]}>
          <span className="flex flex-none">
            <button type="button" onClick={() => api.duplicarLinha(l.id)} title="Duplicar linha" className={BOTAO_CALHA}>
              <Copy className="h-3.5 w-3.5" />
            </button>
          </span>
          <LixeiraDaLinha linha={l} meio={meio.meio} />
        </LinhaDaCalha>
      ))}
    </Calha>
  );
}

// ---- Grade de inserções ---------------------------------------------------

/** As larguras da grade (Tiago, 05/10/2026: com a programação na tela,
 *  Praça, Veículo e Peça · formato ficam apertados).
 *   • na tela: tudo cabe, dias de 12 px;
 *   • larga: colunas folgadas e dias de 20 px; a tabela passa da tela e
 *     rola para o lado, com o título do meio, Praça e Veículo fixos. */
const GRADE = {
  tela: { praca: 88, veiculo: 100, tipo: 36, formato: 72, dia: 12, insercoes: 66 },
  larga: { praca: 136, veiculo: 136, tipo: 40, formato: 128, dia: 20, insercoes: 72 },
} as const;
/** Na larga, o Programa / faixa tem ao menos 240 px; o ORÇADO tem 664. */
const larguraLarga = (nDias: number) => 136 + 136 + 40 + 240 + 128 + nDias * 20 + 72 + 664;
/** Praça e Veículo fixas na larga: fundo opaco e uma sombra na borda. */
const FIXA_PRACA = "sticky left-0 z-[2] bg-white";
const FIXA_VEICULO = "sticky left-[136px] z-[2] bg-white shadow-[6px_0_8px_-6px_rgba(40,40,40,0.18)]";
/** Rótulo de linha de rodapé preso às duas colunas fixas: senão ele passa
 *  por baixo delas ao rolar. */
const FIXA_ROTULO = "sticky left-0 z-[2]";

/** O controle da largura da grade, um só por tela: no formato do "Recolher
 *  todos", na linha dele (Campanha) ou no mesmo lugar (mês). Como ele,
 *  mostra a ação. Vale para todos os meios e meses de TV e rádio. */
export function ControleDaGrade() {
  const api = useApi();
  const Icone = api.gradeLarga ? ChevronsRightLeft : ChevronsLeftRight;
  return (
    <button
      type="button"
      onClick={api.alternarGradeLarga}
      title={
        api.gradeLarga
          ? "Toda a planilha na tela, com as colunas de TV e rádio mais estreitas"
          : "Colunas de TV e rádio folgadas; a planilha rola para o lado"
      }
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
    >
      <Icone className="h-3.5 w-3.5" />
      {api.gradeLarga ? "Caber na tela" : "Alargar colunas"}
    </button>
  );
}

interface PropsDoMeio {
  meio: MeioDaVersao;
  /** O grupo do banco: este meio neste mês. */
  grupoId: string;
  /** "2026-07". */
  mes: string;
  linhas: LinhaMidia[];
  aberta: boolean;
  onAlternar: () => void;
  onNovaLinha: () => void;
  onRemover?: () => void;
  edicao?: EdicaoDoMeio;
}

export function SecaoGrade({ meio, grupoId, mes, linhas, aberta, onAlternar, onNovaLinha, onRemover, edicao }: PropsDoMeio) {
  const api = useApi();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const rolagemRef = React.useRef<HTMLDivElement>(null);
  const dias = React.useMemo(() => diasDoMes(mes), [mes]);
  // Só os dias que o mês tem (Tiago, 05/10/2026): setembro com 30 colunas.
  const nDias = dias.length;
  const larga = api.gradeLarga;
  const L = larga ? GRADE.larga : GRADE.tela;
  const posicoes = usePosicoesDaCalha(wrapperRef, [linhas, aberta, larga]);
  const contas = new Map(linhas.map((l) => [l.id, contaDaLinha(l, api.params)]));
  const totalDoMeio = somar([...contas.values()]);
  const porDia = (d: number) => linhas.reduce((s, l) => s + (l.dias[d] ?? 0), 0);
  const colunas = 5 + nDias + 1 + 7;
  const linhasIds = aberta ? linhas.map((l) => l.id) : [];
  const mesNome = nomeDoMesMidia(mes).split(" ")[0].toLowerCase();
  const colunasNav = React.useMemo<ColunaDaGrade[]>(
    () => [
      { chave: "praca", rotulo: "Praça" },
      { chave: "veiculo", rotulo: "Veículo" },
      { chave: "tipo", rotulo: "Tipo" },
      { chave: "descricao", rotulo: "Programa / faixa" },
      { chave: "formato", rotulo: "Peça · formato" },
      ...dias.map((d) => ({ chave: `dia:${d.dia}`, rotulo: `Dia ${d.dia}`, bloco: "Programação" })),
      { chave: "insercoes", rotulo: "Inserções", bloco: "Programação" },
      ...COLUNAS_VALOR,
    ],
    [dias],
  );
  const nav = useNavDoMeio(linhasIds, colunasNav, wrapperRef);

  // Larga: a célula que o teclado escolhe entra na vista — a seta pode
  // levar a seleção para fora dela.
  const celula = nav.selecao.celula;
  React.useEffect(() => {
    if (!larga || !celula) return;
    wrapperRef.current
      ?.querySelector<HTMLElement>(`[data-cel="${celula.linhaId}:${celula.coluna}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [larga, celula]);

  // Larga: sombra na borda que ainda tem coisa escondida, e os meios de
  // grade rolando juntos (o dia 15 da TV embaixo do dia 15 do rádio). O eco
  // para quando os outros já estão na mesma posição.
  const [bordas, setBordas] = React.useState({ esq: false, dir: false });
  React.useEffect(() => {
    const el = rolagemRef.current;
    if (!larga || !el) return;
    const medir = () =>
      setBordas({ esq: el.scrollLeft > 2, dir: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const aoRolar = () => {
      medir();
      document.querySelectorAll<HTMLElement>("[data-rolagem-grade]").forEach((outro) => {
        if (outro !== el && Math.abs(outro.scrollLeft - el.scrollLeft) > 1) outro.scrollLeft = el.scrollLeft;
      });
    };
    // O meio (ou mês) que aparece agora entra na mesma posição dos que já
    // estavam na tela.
    const outro = [...document.querySelectorAll<HTMLElement>("[data-rolagem-grade]")].find((o) => o !== el);
    if (outro) el.scrollLeft = outro.scrollLeft;
    medir();
    el.addEventListener("scroll", aoRolar, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", aoRolar);
      ro.disconnect();
    };
  }, [larga, aberta]);

  const cabDia = (d: (typeof dias)[number]) => (
    <th
      key={d.dia}
      className={cn(
        "px-0 py-1.5 text-center normal-case leading-none tracking-normal",
        d.fimDeSemana ? VEICULACAO.diaCabecalhoFimDeSemana : VEICULACAO.diaCabecalho,
      )}
      title={`Dia ${d.dia}`}
    >
      <div className={cn("font-mono font-bold text-foreground/80", larga ? "text-[10px]" : "text-[9px]")}>{d.dia}</div>
      <div className={cn("mt-[3px] text-[8.5px] font-semibold", d.fimDeSemana ? "text-california-red/80" : "text-muted-foreground")}>
        {d.inicial}
      </div>
    </th>
  );

  /** Primeira célula de uma linha de rodapé: na larga, o rótulo fica preso
   *  às duas colunas fixas e as outras três seguem vazias, com o mesmo fundo. */
  const rotuloDeRodape = (className: string, conteudo: React.ReactNode) =>
    larga ? (
      <>
        <td colSpan={2} className={cn(className, FIXA_ROTULO)}>
          {conteudo}
        </td>
        <td colSpan={3} className={className} />
      </>
    ) : (
      <td colSpan={5} className={className}>
        {conteudo}
      </td>
    );

  return (
    <div ref={wrapperRef} tabIndex={0} onKeyDown={nav.selecao.onKeyDown} {...nav.card} className="relative outline-none">
      <NavCtx.Provider value={nav}>
        <div className="relative rounded-2xl border border-border bg-card shadow-soft">
          <div
            ref={rolagemRef}
            data-rolagem-grade={larga ? "" : undefined}
            className={cn("rounded-2xl", larga ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden")}
            // A rolagem para a seleção não pode esconder a célula embaixo
            // das duas colunas fixas.
            style={larga ? { scrollPaddingLeft: GRADE.larga.praca + GRADE.larga.veiculo } : undefined}
          >
            <table className="w-full table-fixed border-collapse text-sm" style={larga ? { minWidth: larguraLarga(nDias) } : undefined}>
              <colgroup>
                <col style={{ width: L.praca }} />
                <col style={{ width: L.veiculo }} />
                <col style={{ width: L.tipo }} />
                <col />
                <col style={{ width: L.formato }} />
                {Array.from({ length: nDias }, (_, i) => (
                  <col key={i} style={{ width: L.dia }} />
                ))}
                <col style={{ width: L.insercoes }} />
                <ColsValor />
              </colgroup>
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr data-calha={`g:${grupoId}`}>
                  {/* Na larga o título fica fixo com Praça e Veículo — senão
                      o nome do meio rola para fora e sobra a faixa vazia. */}
                  <th colSpan={larga ? 2 : 5} className={cn(FAIXA_GRUPO, larga ? "sticky left-0 z-[2] px-3" : "px-4")}>
                    <TituloDoMeio meio={meio} qtdLinhas={linhas.length} aberta={aberta} onAlternar={onAlternar} edicao={edicao} compacto={larga} />
                  </th>
                  {larga && <th colSpan={3} className={FAIXA_GRUPO} />}
                  <th colSpan={nDias + 1} className={cn(FAIXA_ROTULO, VEICULACAO.faixa, "whitespace-nowrap")}>
                    PROGRAMAÇÃO · {nomeDoMesMidia(mes)}
                  </th>
                  <th colSpan={7} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                    ORÇADO
                  </th>
                </tr>
                {aberta && (
                  <tr className="bg-muted/40">
                    <th className={cn("px-3 py-2 text-left font-semibold", larga && cn(FIXA_PRACA, VEICULACAO.cabecalhoFixo))}>Praça</th>
                    <th className={cn("px-2 py-2 text-left font-semibold", larga && cn(FIXA_VEICULO, VEICULACAO.cabecalhoFixo))}>Veículo</th>
                    <th className="px-1.5 py-2 text-left font-semibold">Tipo</th>
                    <th className="px-2 py-2 text-left font-semibold">Programa / faixa</th>
                    <th className="px-2 py-2 text-left font-semibold">Peça · formato</th>
                    {dias.map((d) => cabDia(d))}
                    <th className={cn("px-1 py-2 text-right text-[9.5px] font-semibold tracking-normal", VEICULACAO.cabecalho)}>
                      Inserções
                    </th>
                    <CabecalhosValor />
                  </tr>
                )}
              </thead>
              {aberta && (
                <tbody>
                  {linhas.map((l, i) => (
                    <LinhaGrade
                      key={l.id}
                      linha={l}
                      conta={contas.get(l.id)!}
                      dias={dias}
                      idx={i}
                      linhaIds={linhas.map((x) => x.id)}
                      grupoId={grupoId}
                      mes={mes}
                      larga={larga}
                    />
                  ))}
                  {!api.readOnly && (
                    <LinhaDeAcao colSpan={colunas} fixa={larga}>
                      <button type="button" onClick={onNovaLinha} className={BOTAO_NOVO_GRUPO}>
                        <Plus className="h-3.5 w-3.5" />
                        Nova linha
                      </button>
                    </LinhaDeAcao>
                  )}
                  {linhas.length > 0 && (
                    <tr>
                      {rotuloDeRodape(
                        cn(VEICULACAO.pe, "px-4 py-1 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"),
                        "Inserções por dia",
                      )}
                      {dias.map((d) => {
                        const n = porDia(d.dia);
                        return (
                          <td
                            key={d.dia}
                            className={cn("p-0 text-center font-mono text-[9px]", VEICULACAO.diaSoma, n ? "font-bold text-foreground/80" : "text-muted-foreground/40")}
                          >
                            {n}
                          </td>
                        );
                      })}
                      <td className={VEICULACAO.diaSoma} />
                      <td colSpan={7} className={VEICULACAO.pe} />
                    </tr>
                  )}
                </tbody>
              )}
              <tfoot>
                <tr>
                  {rotuloDeRodape(LINHA_TOTAL_ROTULO, <>Total · {meio.meio}</>)}
                  <td colSpan={nDias} className={VEICULACAO.peForte} />
                  <td className={cn(VEICULACAO.peForte, "px-2 text-right font-mono text-[12.5px] font-bold")}>
                    {inteiro(totalDoMeio.quantidade)}
                  </td>
                  <SubtotalValor conta={totalDoMeio} />
                </tr>
              </tfoot>
            </table>
          </div>
          {larga && bordas.dir && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-2xl bg-gradient-to-l from-[rgba(40,40,40,0.12)] to-transparent" />
          )}
          {larga && bordas.esq && (
            <div
              className="pointer-events-none absolute inset-y-0 w-6 bg-gradient-to-r from-[rgba(40,40,40,0.08)] to-transparent"
              style={{ left: GRADE.larga.praca + GRADE.larga.veiculo }}
            />
          )}
        </div>
      </NavCtx.Provider>
      <CalhaDoMeio posicoes={posicoes} meio={meio} grupoId={grupoId} linhas={aberta ? linhas : []} onRemover={onRemover} mesNome={mesNome} />
    </div>
  );
}

function LinhaGrade({
  linha,
  conta,
  dias,
  idx,
  linhaIds,
  grupoId,
  mes,
  larga,
}: {
  linha: LinhaMidia;
  conta: ContaDaLinha;
  dias: ReturnType<typeof diasDoMes>;
  idx: number;
  linhaIds: string[];
  grupoId: string;
  mes: string;
  /** Grade larga: Praça e Veículo ficam fixas na rolagem. */
  larga: boolean;
}) {
  const api = useApi();
  const k = (c: string) => `${linha.id}:${c}`;
  const txt = "px-2 py-1.5 text-[11.5px] text-foreground";
  return (
    <tr data-calha={`l:${linha.id}`} className="border-t border-t-border/70 hover:bg-[#fcfcfb]">
      <Cel linhaId={linha.id} coluna="praca" className={cn(txt, "px-3", larga && FIXA_PRACA)}>
        <Editavel chave={k("praca")} valor={linha.praca} tipo="texto" placeholder="Praça" onSalvar={(v) => api.atualizarLinha(linha.id, { praca: String(v) })} />
      </Cel>
      <CelulaVeiculo linha={linha} className={cn(txt, "font-medium", larga && FIXA_VEICULO)} />
      <CelulaTipo linha={linha} />
      <Cel linhaId={linha.id} coluna="descricao" className={txt}>
        <Editavel chave={k("descricao")} valor={linha.descricao} tipo="texto" placeholder="Programa ou faixa" onSalvar={(v) => api.atualizarLinha(linha.id, { descricao: String(v) })} />
      </Cel>
      <Cel linhaId={linha.id} coluna="formato" className={cn(txt, "text-muted-foreground")}>
        <Editavel
          chave={k("formato")}
          valor={linha.formato}
          tipo="texto"
          placeholder="Formato"
          exibir={
            <span>
              {linha.peca && <span className="mr-1 font-mono font-semibold text-foreground">{linha.peca}</span>}
              {linha.formato}
            </span>
          }
          onSalvar={(v) => api.atualizarLinha(linha.id, { formato: String(v) })}
        />
      </Cel>
      {dias.map((d) => (
        <Dia
          key={d.dia}
          linha={linha}
          dia={d.dia}
          fimDeSemana={d.fimDeSemana}
          ultimoDia={dias.length}
          idx={idx}
          linhaIds={linhaIds}
          grupoId={grupoId}
          mes={mes}
        />
      ))}
      <Cel linhaId={linha.id} coluna="insercoes" className={cn("px-1.5 py-1.5 text-right font-mono text-[11.5px] font-bold", VEICULACAO.celula)}>
        {inteiro(conta.quantidade)}
      </Cel>
      <CelulasValor linha={linha} conta={conta} />
    </tr>
  );
}

// ---- Meio por período -----------------------------------------------------

export function SecaoPeriodo({ meio, grupoId, mes, linhas, aberta, onAlternar, onNovaLinha, onRemover, edicao }: PropsDoMeio) {
  const api = useApi();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const posicoes = usePosicoesDaCalha(wrapperRef, [linhas, aberta]);
  const contas = new Map(linhas.map((l) => [l.id, contaDaLinha(l, api.params)]));
  const total = somar([...contas.values()]);
  const colunas = 5 + 4 + 7;
  const linhasIds = aberta ? linhas.map((l) => l.id) : [];
  const mesNome = nomeDoMesMidia(mes).split(" ")[0].toLowerCase();
  const colunasNav = React.useMemo<ColunaDaGrade[]>(
    () => [
      { chave: "praca", rotulo: "Praça" },
      { chave: "veiculo", rotulo: "Veículo" },
      { chave: "tipo", rotulo: "Tipo" },
      { chave: "descricao", rotulo: "Ponto / descrição" },
      { chave: "formato", rotulo: "Formato" },
      { chave: "inicio", rotulo: "Início", bloco: "Veiculação" },
      { chave: "fim", rotulo: "Fim", bloco: "Veiculação" },
      { chave: "qtde", rotulo: "Qtde", bloco: "Veiculação" },
      { chave: "periodos", rotulo: "Períodos", bloco: "Veiculação" },
      ...COLUNAS_VALOR,
    ],
    [],
  );
  const nav = useNavDoMeio(linhasIds, colunasNav, wrapperRef);
  return (
    <div ref={wrapperRef} tabIndex={0} onKeyDown={nav.selecao.onKeyDown} {...nav.card} className="relative outline-none">
      <NavCtx.Provider value={nav}>
        <div className="rounded-2xl border border-border bg-card shadow-soft">
          <div className="overflow-hidden rounded-2xl">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col style={{ width: 128 }} />
                <col style={{ width: 104 }} />
                <col style={{ width: 38 }} />
                <col />
                <col style={{ width: 88 }} />
                <col style={{ width: 86 }} />
                <col style={{ width: 86 }} />
                <col style={{ width: 46 }} />
                {/* 90: "2 bissemanas" cortava em 86. */}
                <col style={{ width: 90 }} />
                <ColsValor />
              </colgroup>
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr data-calha={`g:${grupoId}`}>
                  <th colSpan={5} className={cn(FAIXA_GRUPO, "px-4")}>
                    <TituloDoMeio meio={meio} qtdLinhas={linhas.length} aberta={aberta} onAlternar={onAlternar} edicao={edicao} />
                  </th>
                  <th colSpan={4} className={cn(FAIXA_ROTULO, VEICULACAO.faixa)}>
                    VEICULAÇÃO · {nomeDoMesMidia(mes)}
                  </th>
                  <th colSpan={7} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                    ORÇADO
                  </th>
                </tr>
                {aberta && (
                  <tr className="bg-muted/40">
                    <th className="px-3 py-2 text-left font-semibold">Praça</th>
                    <th className="px-2 py-2 text-left font-semibold">Veículo</th>
                    <th className="px-1.5 py-2 text-left font-semibold">Tipo</th>
                    <th className="px-2 py-2 text-left font-semibold">Ponto / descrição</th>
                    <th className="px-2 py-2 text-left font-semibold">Formato</th>
                    <th className={cn("px-2 py-2 text-left font-semibold", VEICULACAO.cabecalho)}>Início</th>
                    <th className={cn("px-2 py-2 text-left font-semibold", VEICULACAO.cabecalho)}>Fim</th>
                    <th className={cn("px-2 py-2 text-right font-semibold", VEICULACAO.cabecalho)}>Qtde</th>
                    <th className={cn("px-2 py-2 text-right font-semibold", VEICULACAO.cabecalho)}>× Períodos</th>
                    <CabecalhosValor />
                  </tr>
                )}
              </thead>
              {aberta && (
                <tbody>
                  {linhas.map((l) => (
                    <LinhaPeriodo key={l.id} linha={l} conta={contas.get(l.id)!} />
                  ))}
                  {!api.readOnly && (
                    <LinhaDeAcao colSpan={colunas}>
                      <button type="button" onClick={onNovaLinha} className={BOTAO_NOVO_GRUPO}>
                        <Plus className="h-3.5 w-3.5" />
                        Nova linha
                      </button>
                    </LinhaDeAcao>
                  )}
                </tbody>
              )}
              <tfoot>
                <tr>
                  <td colSpan={5} className={LINHA_TOTAL_ROTULO}>
                    Total · {meio.meio}
                  </td>
                  <td colSpan={2} className={VEICULACAO.peForte} />
                  <td className={cn(VEICULACAO.peForte, "px-2 text-right font-mono text-[12.5px] font-bold")}>
                    {inteiro(linhas.reduce((s, l) => s + (l.qtde || 0), 0))}
                  </td>
                  <td className={VEICULACAO.peForte} />
                  <SubtotalValor conta={total} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </NavCtx.Provider>
      <CalhaDoMeio posicoes={posicoes} meio={meio} grupoId={grupoId} linhas={aberta ? linhas : []} onRemover={onRemover} mesNome={mesNome} />
    </div>
  );
}

function LinhaPeriodo({ linha, conta }: { linha: LinhaMidia; conta: ContaDaLinha }) {
  const api = useApi();
  const k = (c: string) => `${linha.id}:${c}`;
  const txt = "px-2 py-1.5 text-[11.5px] text-foreground align-top";
  return (
    <tr data-calha={`l:${linha.id}`} className="border-t border-t-border/70 hover:bg-[#fcfcfb]">
      <Cel linhaId={linha.id} coluna="praca" className={cn(txt, "px-3")}>
        {/* Cidade longa ("Visconde do Rio Branco/MG") quebra em vez de
            cortar: a linha por período já tem duas linhas. */}
        <Editavel quebra chave={k("praca")} valor={linha.praca} tipo="texto" placeholder="Praça" onSalvar={(v) => api.atualizarLinha(linha.id, { praca: String(v) })} />
      </Cel>
      <CelulaVeiculo linha={linha} className={cn(txt, "font-medium")} />
      <CelulaTipo linha={linha} />
      <Cel linhaId={linha.id} coluna="descricao" className={txt}>
        <Editavel quebra chave={k("descricao")} valor={linha.descricao} tipo="texto" placeholder="Ponto ou descrição" onSalvar={(v) => api.atualizarLinha(linha.id, { descricao: String(v) })} />
        {linha.detalhe && <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">{linha.detalhe}</div>}
      </Cel>
      <Cel linhaId={linha.id} coluna="formato" className={cn(txt, "text-muted-foreground")}>
        <Editavel quebra chave={k("formato")} valor={linha.formato} tipo="texto" placeholder="Formato" onSalvar={(v) => api.atualizarLinha(linha.id, { formato: String(v) })} />
      </Cel>
      <CelulasDatas linha={linha} />
      <Cel linhaId={linha.id} coluna="qtde" className={cn(txt, "text-right font-mono", VEICULACAO.celula)}>
        <Editavel chave={k("qtde")} valor={linha.qtde} tipo="inteiro" exibir={inteiro(linha.qtde)} onSalvar={(v) => api.atualizarLinha(linha.id, { qtde: Number(v) })} />
      </Cel>
      <Cel linhaId={linha.id} coluna="periodos" className={cn(txt, "text-right font-mono", VEICULACAO.celula)}>
        <Editavel
          chave={k("periodos")}
          valor={linha.periodos}
          tipo="inteiro"
          exibir={
            <span>
              {inteiro(linha.periodos)}{" "}
              <span className="font-sans text-[10.5px] text-muted-foreground">
                {linha.unidadePeriodo === "mês" ? (linha.periodos === 1 ? "mês" : "meses") : linha.unidadePeriodo}
              </span>
            </span>
          }
          onSalvar={(v) => api.atualizarLinha(linha.id, { periodos: Number(v) })}
        />
      </Cel>
      <CelulasValor linha={linha} conta={conta} />
    </tr>
  );
}

// ---- Total de todos os meios (as mesmas colunas de valor) ----------------

export function TotalDaMidia({
  conta,
  qtdMeios,
  qtdLinhas,
  rotulo,
}: {
  conta: ContaDaLinha;
  qtdMeios: number;
  qtdLinhas: number;
  rotulo: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="overflow-hidden rounded-2xl">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col />
            <ColsValor />
          </colgroup>
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="bg-muted/40">
              <th className="px-4 py-2 text-left font-semibold" />
              <CabecalhosValor />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={cn(LINHA_TOTAL_ROTULO, "px-4 py-2.5")}>
                <span className="text-[11px]">{rotulo}</span>
                <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                  {qtdMeios} {qtdMeios === 1 ? "meio" : "meios"} · {qtdLinhas} {qtdLinhas === 1 ? "linha" : "linhas"}
                </span>
              </td>
              <SubtotalValor conta={conta} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
