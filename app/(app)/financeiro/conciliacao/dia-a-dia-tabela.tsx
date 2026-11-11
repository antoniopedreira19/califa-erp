"use client";

/**
 * A tabela da conciliação dia a dia (decisão 253): a linha do banco e, ao
 * lado, os lançamentos do sistema que a compõem, na ordem do extrato.
 *
 * Uma regra só para todos os casos: cada linha do banco tem uma lista de
 * lançamentos do sistema (baixas já feitas, títulos em aberto, linhas da
 * planilha). O sistema preenche a lista com o que achou no dia; a pessoa
 * retira, adiciona e troca no próprio lugar, e nada é gravado até o
 * Conciliar. A coluna "Status" tem três estados (Pronto, A definir,
 * Faltando), e a ação é sempre Conciliar.
 *
 * O saldo depois de cada linha parte do saldo do banco que o fechamento
 * confere (`condicoes_do_fechamento`), e não de uma soma feita na tela a
 * partir do zero.
 */

import * as React from "react";
import { ArrowDown, CheckCheck, ChevronDown, ChevronRight, CircleSlash, FilePlus2, Link2, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Undo2, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dica } from "@/components/ui/dica";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { siglaDaRegional, textoDaRegional, trimestreDe } from "@/lib/financeiro/planilha-de-titulos";
import { BotaoDaSecao, comCentro, CONTORNO, VERDE } from "./banco-tabela";
import { InfoDica, linhasComMutuo, resumoDoSistema, type AcaoDescrita, type Item, type PropsDaFila } from "./fila-da-conta";
import { celulasDoItem } from "./fila-linhas";
import { itemDoLote, type ResultadoDaLinha } from "./motor-da-conta";
import { EditarDataPagamentoDialog } from "../contas-a-pagar/editar-data-pagamento-dialog";
import { EditarPrevisaoDialog } from "../contas-a-receber/editar-previsao-dialog";
import { naOrdemDoExtrato, saldosDoExtrato, type SaldoBase } from "@/lib/conciliacao/dia-a-dia";
import type { EntradaDaBaixaEmLote } from "@/lib/financeiro/baixa-em-lote";
import type { LancamentoSemLinha } from "./banco-dados";
import type { TituloDoMotor } from "@/lib/conciliacao/motor";
import type { Linha } from "./linhas-da-aba";

const moeda = formatBRL;
const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (v: number) => Math.round(Math.abs(v) * 100);
const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
const comSinal = (v: number) => `${v < 0 ? "− " : "+ "}${moeda(Math.abs(v))}`;
const CEL = "px-3 py-2 align-top";
const Traco = () => <span className="text-muted-foreground/60">—</span>;
/** O texto que pode não caber: cortado na célula, inteiro ao passar o mouse
 *  (a mesma dica das outras planilhas do sistema). */
function Txt({ t, dica, className }: { t: string | null | undefined; dica?: React.ReactNode; className?: string }) {
  if (!t) return <Traco />;
  return (
    <Dica conteudo={dica ?? t} className={cn("block w-full truncate text-left", className)}>
      {t}
    </Dica>
  );
}

// ---------------------------------------------------------------------------
// Os lançamentos do sistema que podem compor uma linha do banco
// ---------------------------------------------------------------------------

type Base = { id: string; data: string; valor: number; descricao: string; quem: string | null; /** A linha do banco a que o sistema o propôs; nulo, está livre. */ daLinha: string | null };
export type Candidato =
  | (Base & { k: "baixa"; l: LancamentoSemLinha })
  | (Base & { k: "titulo"; t: TituloDoMotor })
  | (Base & { k: "planilha"; h: NonNullable<PropsDaFila["banco"]["previsoes"]>[number]; /** Previsão (ainda não aconteceu) ou linha já realizada da planilha. */ previsao: boolean });

/** Tudo o que o sistema tem e ainda não está conciliado: o que está livre e o
 *  que o sistema propôs a alguma linha (dá para tirar de lá pela lupa). */
export function itensDoSistema(p: PropsDaFila): Candidato[] {
  const daL = new Map<string, string>();
  const daT = new Map<string, string>();
  const daH = new Map<string, string>();
  for (const r of p.conciliacao.resultados) {
    if (r.resolvido) continue;
    if (r.lancamento) {
      daL.set(r.lancamento.id, r.mov.id);
      ((r.lancamento as { membros?: string[] }).membros ?? []).forEach((id) => daL.set(id, r.mov.id));
    }
    for (const t of [r.titulo, ...(r.titulos ?? []), ...(r.lote?.titulos ?? [])]) if (t) daT.set(t.id, r.mov.id);
    for (const h of r.historicos ?? []) daH.set(h.id, r.mov.id);
  }
  const saida: Candidato[] = [];
  for (const l of p.banco.lancamentos) saida.push({ k: "baixa", id: "l:" + l.id, data: l.data, valor: l.valor, descricao: l.descricao, quem: l.fornecedor, daLinha: daL.get(l.id) ?? null, l });
  for (const t of p.conciliacao.titulos.values()) {
    const l = p.contexto.linhaPorChave.get(t.id);
    saida.push({ k: "titulo", id: "t:" + t.id, data: t.vencimento, valor: (t.lado === "receber" || t.entra ? 1 : -1) * t.liquido, descricao: l?.descricao ?? t.ref, quem: t.contraparte, daLinha: daT.get(t.id) ?? null, t });
  }
  const daPlanilha = (h: NonNullable<PropsDaFila["banco"]["previsoes"]>[number], previsao: boolean) =>
    saida.push({ k: "planilha", id: "h:" + h.id, data: h.data, valor: h.valor, descricao: h.descricao ?? h.job ?? "Planilha", quem: h.fornecedor ?? null, daLinha: daH.get(h.id) ?? null, h, previsao });
  for (const h of p.banco.previsoes ?? []) daPlanilha(h, true);
  for (const h of p.banco.historico ?? []) daPlanilha(h, false);
  return saida;
}

/** O que a tabela pede ao servidor além das ações de sempre da aba. */
export interface AcoesDoDia {
  /** Baixas já feitas e títulos em aberto pagos pela mesma linha do banco. */
  conciliarMisto: (linhaId: string, lancamentoIds: string[], itens: EntradaDaBaixaEmLote["itens"]) => void;
  mudarDataDoTitulo: (l: Linha, data: string) => void;
  /** A baixa lançada no dia errado, ainda sem linha do banco. */
  mudarDataDaBaixa: (lancamentoIds: string[], data: string) => void;
  /** A previsão da planilha: a data ajustada sobrevive à carga nova. */
  mudarDataDaPrevisao: (movimentoId: string, data: string) => void;
}

// ---------------------------------------------------------------------------
// A composição de uma linha do banco
// ---------------------------------------------------------------------------

/** O ajuste que fecha a conta quando a soma não é igual à do banco. */
type Ajuste = "juros" | "retencao" | "parcial" | "correcao";
/** O que o sistema resolve sem lançamento existente. */
interface Especial {
  k: "regra" | "par" | "mutuo";
  texto: string;
}
interface Edicao {
  itens: string[];
  ajuste: Ajuste | null;
}
interface Comp {
  r: ResultadoDaLinha;
  itens: Candidato[];
  especial: Especial | null;
  ajuste: Ajuste | null;
  editada: boolean;
  soma: number;
  /** Banco menos sistema: positivo, o banco tem mais (em valor absoluto). */
  falta: number;
  estado: "bate" | "ajuste" | "difere" | "vazio";
  /** A Situação que a pessoa lê: três estados, pelo que ela faz.
   *  Pronto: a soma fecha, é só conciliar. A definir: há o que decidir (a soma
   *  não fecha, ou o sistema tem mais de um lançamento possível, no dia ou em
   *  outra data). Sem lançamento: o sistema não tem nada com esse valor. */
  situacao: "pronto" | "conferir" | "sem";
  /** Sem lançamento na linha: quantos livres o sistema tem com o mesmo valor, no dia e a até 7 dias. */
  iguaisNoDia: number;
  emOutraData: number;
}

const ROTULO_DO_TIPO: Record<Candidato["k"], string> = { baixa: "baixado", titulo: "em aberto", planilha: "planilha" };
const ROTULO_DO_AJUSTE: Record<Ajuste, string> = { juros: "juros e multa", retencao: "retenção na fonte", parcial: "baixa parcial", correcao: "corrige a baixa" };

/** As siglas do Tipo, como a planilha do financeiro escreve (decisão 243). */
const SIGLA_DO_TIPO: Record<string, string> = {
  "01": "REC", "02": "CO", "03": "CT", "04": "CF", "05": "DP", "06": "DM", "07": "DA", "08": "DC",
  "09": "DT", "10": "RF", "11": "DJ", "12": "EMP", "13": "IMOB", "14": "PL", "15": "DL",
};

/** Job, Tipo, TRI e Reg de um lançamento do sistema. */
function extras(c: Candidato, p: PropsDaFila): { job: string | null; tipo: string | null; tri: string; reg: string | null } {
  if (c.k === "baixa") {
    const e = p.banco.extratoPorLancamento[c.l.id];
    return { job: e?.job?.codigo ?? null, tipo: e?.tipo ? SIGLA_DO_TIPO[e.tipo] ?? e.tipo : null, tri: e?.tri ?? trimestreDe(c.data), reg: e?.reg ? (e.reg === "TD" ? "TD" : siglaDaRegional(e.reg)) : null };
  }
  if (c.k === "planilha") return { job: c.h.job ?? null, tipo: c.h.grupo ?? null, tri: trimestreDe(c.data), reg: c.h.regional ? (c.h.regional === "TD" ? "TD" : siglaDaRegional(c.h.regional)) : null };
  const l = p.contexto.linhaPorChave.get(c.t.id);
  const cod = l?.centro.tipo === "plano" ? l.centro.rotulo.match(/^(\d{2})\b/)?.[1] : null;
  const reg = l?.rateio.length ? textoDaRegional(l.rateio).texto : "—";
  return { job: l?.job?.codigo ?? null, tipo: cod ? SIGLA_DO_TIPO[cod] ?? cod : null, tri: trimestreDe(c.data), reg: reg === "—" ? null : reg };
}

/** O que o sistema achou para a linha, como lista de lançamentos. */
function sugestaoDe(r: ResultadoDaLinha, nosGrupos: Set<string>, p: PropsDaFila): { itens: string[]; especial: Especial | null; ajuste: Ajuste | null } {
  const vazio = { itens: [] as string[], especial: null as Especial | null, ajuste: null as Ajuste | null };
  if (r.mutuo) return { ...vazio, especial: { k: "mutuo", texto: resumoDoSistema(r, p.contexto) } };
  switch (r.estado) {
    case "regra":
      return { ...vazio, especial: { k: "regra", texto: resumoDoSistema(r, p.contexto) } };
    case "par":
      return { ...vazio, especial: { k: "par", texto: resumoDoSistema(r, p.contexto) } };
    case "ja_lancado": {
      const membros = (r.lancamento as { membros?: string[] } | undefined)?.membros;
      return { ...vazio, itens: (membros ?? (r.lancamento ? [r.lancamento.id] : [])).map((id) => "l:" + id) };
    }
    case "divergencia":
      return { ...vazio, itens: r.lancamento ? ["l:" + r.lancamento.id] : [], ajuste: "correcao" };
    case "sugestao":
      return nosGrupos.has(r.mov.id) || !r.titulo ? vazio : { ...vazio, itens: ["t:" + r.titulo.id] };
    case "diferenca":
      return { ...vazio, itens: r.titulo ? ["t:" + r.titulo.id] : [], ajuste: r.retencaoSugerida ? "retencao" : "juros" };
    case "combinacao":
      return r.confianca === "alta" ? { ...vazio, itens: (r.titulos ?? []).map((t) => "t:" + t.id) } : vazio;
    case "soma":
      return { ...vazio, itens: (r.lote?.titulos ?? []).map((t) => "t:" + t.id) };
    case "historico":
      return r.confianca === "alta" ? { ...vazio, itens: (r.historicos ?? []).map((h) => "h:" + h.id) } : vazio;
    default:
      return vazio;
  }
}

/** O ajuste que cabe na composição (o que a diferença pode ser). */
function ajustesPossiveis(c: Pick<Comp, "itens" | "falta" | "r">): Ajuste[] {
  if (!c.itens.length || cents(c.falta) === 0) return [];
  const baixas = c.itens.filter((i) => i.k === "baixa");
  const titulos = c.itens.filter((i) => i.k === "titulo");
  const bancoMaior = Math.abs(c.r.mov.valor) > Math.abs(c.r.mov.valor - c.falta);
  if (baixas.length === 1 && c.itens.length === 1) return ["correcao"];
  if (baixas.length || !titulos.length || titulos.length !== c.itens.length) return [];
  if (bancoMaior) return titulos.length === 1 && c.r.mov.valor < 0 ? ["juros"] : [];
  // Sobra: o último título pode ser pago só em parte, se a parte for positiva.
  const cabeParcial = Math.abs(titulos[titulos.length - 1].valor) - Math.abs(c.falta) > 0.004;
  const parcial: Ajuste[] = cabeParcial ? ["parcial"] : [];
  return titulos.length === 1 && c.r.mov.valor > 0 ? ["retencao", ...parcial] : parcial;
}

/** Quanto o último título paga na baixa parcial. */
const parteDoUltimo = (c: Pick<Comp, "itens" | "falta">) => r2(Math.abs(c.itens[c.itens.length - 1]?.valor ?? 0) - Math.abs(c.falta));

// ---------------------------------------------------------------------------
// A tabela
// ---------------------------------------------------------------------------

/**
 * As larguras: banco (Data, Descrição, Valor, Saldo) e sistema (Data, Valor,
 * Descrição, Fornecedor, Job, Tipo, TRI, Reg), depois Status e Ação.
 */
const LARGURAS = [70, 166, 122, 112, 104, 114, 230, 130, 98, 50, 44, 48, 104, 152];
const LARGURA = LARGURAS.reduce((s, w) => s + w, 0);
const COLUNAS = LARGURAS.length;
/** Onde começam e acabam as colunas do lado do sistema (a lista de troca abre embaixo delas). */
const SISTEMA_DE = 4;
const SISTEMA_ATE = 12;
const BOTAO_DA_ACAO = "w-[92px]";

const CSS_DA_TABELA =
  ".comp-corte tr > td.corte, .comp-corte tr > th.corte { border-left: 2px solid hsl(var(--border)); } .comp-corte tr:hover > td.sis { background-color: hsl(var(--muted) / 0.7); }";

const Saldos = React.createContext<Map<string, number>>(new Map());
const DICA_DO_SALDO = "O saldo do banco depois desta linha, na ordem do extrato.";
/** Sem o "R$" (como no extrato): cabe até a casa dos milhões. */
const textoDoSaldo = (v: number) => `${v < 0 ? "− " : ""}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CelulaDoSaldo({ id, rowSpan, apagada }: { id: string; rowSpan?: number; apagada?: boolean }) {
  const v = React.useContext(Saldos).get(id);
  return (
    <td rowSpan={rowSpan} title={v === undefined ? "O extrato importado não informa o saldo do banco." : DICA_DO_SALDO} className={cn("whitespace-nowrap text-right align-top font-mono text-xs", CEL, v !== undefined && v < 0 ? "text-california-red" : apagada ? "text-muted-foreground" : "text-foreground/80")}>
      {v === undefined ? <Traco /> : textoDoSaldo(v)}
    </td>
  );
}

type Filtro = "todas" | "conferir" | "sem" | "pronto" | "conciliadas";

export function TabelaDeComposicoes({
  p,
  dia,
  itensDoSistema,
  saldoBase,
  servidor,
  avisar,
}: {
  p: PropsDaFila;
  /** O dia aberto; nulo, todos os dias em aberto. */
  dia: string | null;
  itensDoSistema: Candidato[];
  /** O saldo do banco no fim de um dia, conferido pelo servidor; nulo, o extrato não informa saldo. */
  saldoBase: SaldoBase | null;
  servidor: AcoesDoDia;
  avisar: (texto: string) => void;
}) {
  const { acoes, pending } = p;
  const porId = React.useMemo(() => new Map(itensDoSistema.map((c) => [c.id, c])), [itensDoSistema]);
  const resultados = React.useMemo(() => linhasComMutuo(p.secoes, p.conciliacao.resultados), [p.secoes, p.conciliacao.resultados]);
  const nosGrupos = React.useMemo(() => new Set(p.secoes.grupos.flatMap((g) => g.linhas.map((r) => r.mov.id as string))), [p.secoes.grupos]);
  const saldos = React.useMemo(() => saldosDoExtrato(p.banco.linhas, saldoBase), [p.banco.linhas, saldoBase]);

  // ---- O que a pessoa mudou (até conciliar, fica só na tela) ----
  const [edicoes, setEdicoes] = React.useState<Record<string, Edicao>>({});
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [recolhidas, setRecolhidas] = React.useState<Set<string>>(new Set());

  const comps = React.useMemo(() => {
    const pend = resultados.filter((r) => !r.resolvido && (!dia || r.mov.data === dia));
    const todasPend = resultados.filter((r) => !r.resolvido);
    const tomados = new Map<string, string>();
    for (const r of todasPend) for (const id of edicoes[r.mov.id]?.itens ?? []) tomados.set(id, r.mov.id);
    const base = new Map<string, { itens: string[]; especial: Especial | null; ajuste: Ajuste | null; editada: boolean }>();
    for (const r of todasPend) {
      const e = edicoes[r.mov.id];
      if (e) {
        base.set(r.mov.id, { itens: e.itens, especial: null, ajuste: e.ajuste, editada: true });
        continue;
      }
      const s = sugestaoDe(r, nosGrupos, p);
      // O que a pessoa levou para outra linha sai da sugestão desta.
      const itens = s.itens.filter((id) => !tomados.has(id) && porId.has(id));
      itens.forEach((id) => tomados.set(id, r.mov.id));
      base.set(r.mov.id, { itens, especial: s.especial, ajuste: itens.length === s.itens.length ? s.ajuste : null, editada: false });
    }
    const montar = (r: ResultadoDaLinha): Comp => {
      const b = base.get(r.mov.id)!;
      const itens = b.itens.map((id) => porId.get(id)).filter((c): c is Candidato => !!c);
      const soma = r2(itens.reduce((s, c) => s + c.valor, 0));
      const falta = r2(r.mov.valor - soma);
      const c = { r, itens, especial: b.especial, ajuste: b.ajuste, editada: b.editada, soma, falta };
      const ajuste = b.ajuste && ajustesPossiveis(c).includes(b.ajuste) ? b.ajuste : null;
      const estado: Comp["estado"] = b.especial ? "bate" : !itens.length ? "vazio" : cents(falta) === 0 ? "bate" : ajuste ? "ajuste" : "difere";
      const mesmoValor = (x: Candidato) => !tomados.has(x.id) && cents(x.valor) === cents(r.mov.valor) && Math.sign(x.valor) === Math.sign(r.mov.valor);
      const iguaisNoDia = estado === "vazio" ? itensDoSistema.filter((x) => mesmoValor(x) && x.data === r.mov.data).length : 0;
      const emOutraData = estado === "vazio" ? itensDoSistema.filter((x) => mesmoValor(x) && x.data !== r.mov.data && Math.abs(diasEntre(r.mov.data, x.data)) <= 7).length : 0;
      const situacao: Comp["situacao"] = estado === "bate" || estado === "ajuste" ? "pronto" : estado === "difere" || iguaisNoDia || emOutraData ? "conferir" : "sem";
      return { ...c, ajuste, estado, situacao, iguaisNoDia, emOutraData };
    };
    // Todas as pendentes montadas: a linha de origem de um lançamento pode ser de outro dia.
    const porLinha = new Map(todasPend.map((r) => [r.mov.id as string, montar(r)]));
    return { lista: pend.map((r) => porLinha.get(r.mov.id) as Comp), tomados, porLinha };
  }, [resultados, edicoes, nosGrupos, porId, dia, p, itensDoSistema]);

  const editar = (c: Comp, itens: string[], ajuste: Ajuste | null = null) => {
    setEdicoes((e) => {
      const novo = { ...e, [c.r.mov.id]: { itens, ajuste } };
      // O lançamento que veio de outra linha editada sai de lá.
      for (const [linha, ed] of Object.entries(novo)) if (linha !== c.r.mov.id) novo[linha] = { ...ed, itens: ed.itens.filter((id) => !itens.includes(id)) };
      return novo;
    });
    setAbertas((a) => ({ ...a, [c.r.mov.id]: true }));
  };
  // O lançamento escolhido está em outra linha do banco: antes de mover, a
  // confirmação mostra de onde sai e para onde vai (pedido do Tiago, 10/11/2026).
  const [movendo, setMovendo] = React.useState<{ destino: Comp; id: string; trocarDe: string | null } | null>(null);
  const aplicar = (c: Comp, id: string, trocarDe: string | null) =>
    editar(c, trocarDe ? c.itens.map((i) => (i.id === trocarDe ? id : i.id)) : [...c.itens.map((i) => i.id), id], null);
  const escolher = (c: Comp, id: string, trocarDe: string | null) => {
    const outra = comps.tomados.get(id);
    if (outra && outra !== c.r.mov.id && comps.porLinha.has(outra)) setMovendo({ destino: c, id, trocarDe });
    else aplicar(c, id, trocarDe);
  };
  const desfazerEdicao = (c: Comp) =>
    setEdicoes((e) => {
      const { [c.r.mov.id]: _fora, ...resto } = e;
      return resto;
    });

  // ---- Só no sistema: o que é do dia e não está em nenhuma linha ----
  const livres = React.useMemo(
    () =>
      itensDoSistema
        .filter((c) => !comps.tomados.has(c.id) && (dia ? c.data === dia : c.k === "baixa"))
        .sort((a, b) => (a.k === "baixa" ? 0 : 1) - (b.k === "baixa" ? 0 : 1) || a.data.localeCompare(b.data)),
    [itensDoSistema, comps.tomados, dia],
  );
  const conciliadas = resultados.filter((r) => r.resolvido && (!dia || r.mov.data === dia));

  // ---- Conciliar: a mesma ação para todos os casos ----
  const conciliarMisto = (r: ResultadoDaLinha, baixas: Array<Extract<Candidato, { k: "baixa" }>>, titulos: Array<Extract<Candidato, { k: "titulo" }>>, parteDoUltimoTitulo: number | null = null) => {
    const itens = titulos.map((c, k) => {
      const l = p.contexto.linhaPorChave.get(c.t.id);
      const item = l ? itemDoLote(l) : null;
      // A baixa parcial: o último título sai só pela parte que o banco pagou.
      return item && parteDoUltimoTitulo !== null && k === titulos.length - 1 ? { ...item, aberto: parteDoUltimoTitulo } : item;
    });
    const prontos = itens.filter((i): i is NonNullable<typeof i> => !!i);
    const ultimo = titulos[titulos.length - 1];
    const doUltimo = ultimo ? p.contexto.linhaPorChave.get(ultimo.t.id) : undefined;
    if (parteDoUltimoTitulo !== null && doUltimo && cents(itemDoLote(doUltimo)?.aberto ?? 0) !== cents(ultimo.valor)) {
      return avisar("O título pago em parte tem retenção na fonte: concilie-o sozinho nesta linha, pela baixa completa, e junte o resto depois.");
    }
    if (prontos.length !== itens.length) return avisar("Um dos títulos pede a baixa completa (centro de custo, fatura ou guia): concilie este título sozinho primeiro.");
    servidor.conciliarMisto(r.mov.id, baixas.flatMap((c) => c.l.ids), prontos);
  };
  const conciliar = (c: Comp) => {
    const r = c.r;
    if (c.especial) return c.especial.k === "regra" ? acoes.lancarRegra([r]) : c.especial.k === "par" ? acoes.conciliarPar(r) : acoes.lancarMutuo(r);
    const baixas = c.itens.filter((i): i is Extract<Candidato, { k: "baixa" }> => i.k === "baixa");
    const titulos = c.itens.filter((i): i is Extract<Candidato, { k: "titulo" }> => i.k === "titulo");
    const planilha = c.itens.filter((i): i is Extract<Candidato, { k: "planilha" }> => i.k === "planilha");
    if (planilha.length) return acoes.conciliarHistorico([{ ...r, estado: "historico", historicos: planilha.map((i) => i.h) }]);
    if (c.ajuste === "correcao" && baixas.length === 1) return acoes.corrigirBaixa({ ...r, estado: "divergencia", lancamento: baixas[0].l, diferencaBaixa: r2(Math.abs(baixas[0].valor) - Math.abs(r.mov.valor)) });
    if (baixas.length && titulos.length) return conciliarMisto(r, baixas, titulos, c.ajuste === "parcial" ? parteDoUltimo(c) : null);
    if (baixas.length === 1) return acoes.ligar({ ...r, estado: "ja_lancado", lancamento: baixas[0].l });
    if (baixas.length) return acoes.conciliarAgrupamento([r.mov.id], baixas.flatMap((i) => i.l.ids), [r.mov.data, ...baixas.map((i) => i.data)]);
    const ts = titulos.map((i) => i.t);
    // Um título: o que não é de um clique (ajuste, centro de custo) abre a baixa preenchida.
    if (ts.length === 1) return c.estado === "bate" && comCentro(ts[0]) ? acoes.conciliarGrupo([r], ts) : acoes.conferirTitulo(r.titulo?.id === ts[0].id ? r : { ...r, retencaoSugerida: undefined, retencaoAliquotas: undefined, diferenca: undefined }, ts[0]);
    if (c.estado === "bate") return acoes.conciliarCombinacao({ ...r, estado: "combinacao", titulos: ts });
    if (c.ajuste === "parcial") return conciliarMisto(r, [], titulos, parteDoUltimo(c));
    return acoes.conferirCombinacao({ ...r, estado: "combinacao", titulos: ts });
  };

  // "Conciliar os N": só o que o sistema sugeriu, ninguém mexeu e sai num clique.
  const deUmClique = (c: Comp) =>
    !c.editada &&
    c.estado === "bate" &&
    !c.r.mutuo &&
    (["ja_lancado", "soma", "regra"].includes(c.r.estado) ||
      (c.r.estado === "historico" && !!c.r.historicos?.length) ||
      (c.r.estado === "par" && c.r.mov.valor > 0) ||
      (c.r.estado === "sugestao" && comCentro(c.r.titulo)) ||
      (c.r.estado === "combinacao" && (c.r.titulos ?? []).every((t) => comCentro(t))));
  const emLote = comps.lista.filter(deUmClique);

  // ---- Editar a data, como na aba Títulos ----
  const [editando, setEditando] = React.useState<Candidato | null>(null);
  const linhaDe = (c: Candidato | null): Linha | null => (c?.k === "titulo" ? (p.contexto.linhaPorChave.get(c.t.id) ?? null) : null);
  const salvarData = (c: Candidato, data: string) => {
    setEditando(null);
    if (c.k === "baixa") return servidor.mudarDataDaBaixa(c.l.ids, data);
    if (c.k === "planilha") return servidor.mudarDataDaPrevisao(c.h.id, data);
    const l = linhaDe(c);
    if (l?.editaData) servidor.mudarDataDoTitulo(l, data);
  };
  /** O que muda de data por aqui: a baixa, a previsão da planilha e o título
   *  que a aba Títulos já edita (PP, avulso e nota). O desembolso, a fatura, a
   *  guia, o estorno e a transferência em aberto ficam para depois. */
  const editaData = (c: Candidato) => (c.k === "baixa" ? true : c.k === "planilha" ? c.previsao : !!linhaDe(c)?.editaData);
  const lEdit = linhaDe(editando);
  const notaAReceber = editando?.k === "titulo" && lEdit?.lado === "receber" && lEdit?.editaData;

  // ---- As seções ----
  const prontas = comps.lista.filter((c) => c.situacao === "pronto");
  const aConferir = comps.lista.filter((c) => c.situacao === "conferir");
  const semLancamento = comps.lista.filter((c) => c.situacao === "sem");
  const abertas2 = [...aConferir, ...semLancamento];
  const alternar = (k: string) =>
    setRecolhidas((s) => {
      const x = new Set(s);
      if (x.has(k)) x.delete(k);
      else x.add(k);
      return x;
    });
  const botaoEmLote =
    emLote.length > 1 ? (
      <BotaoDaSecao verde disabled={pending} onClick={() => p.conciliarVarios(emLote.map((c) => c.r))}>
        <CheckCheck className="h-3.5 w-3.5" />
        Conciliar as {emLote.length} prontas
      </BotaoDaSecao>
    ) : null;

  const cabecalho = (k: string, titulo: string, n: number, ponto: string, dica: string, botao: React.ReactNode = null) => (
    <tbody key={"cab-" + k}>
      <tr className="border-b border-border bg-muted/60">
        <td colSpan={COLUNAS} className="px-3 py-2">
          <span className="flex items-center gap-2.5">
            <button type="button" onClick={() => alternar(k)} aria-expanded={!recolhidas.has(k)} className="flex items-center gap-2.5 text-left">
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", recolhidas.has(k) && "-rotate-90")} />
              <span className={cn("h-2 w-2 rounded-full", ponto)} />
              <span className="text-[13px] font-semibold text-foreground">{titulo}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{n}</span>
            </button>
            <InfoDica texto={dica} />
            <span className="flex-1" />
            {botao}
          </span>
        </td>
      </tr>
    </tbody>
  );

  const linhaDaComp = (c: Comp) => (
    <LinhaDoBanco
      key={c.r.mov.id}
      c={c}
      p={p}
      aberta={abertas[c.r.mov.id] ?? (c.estado === "difere" || c.estado === "vazio")}
      alternar={() => setAbertas((a) => ({ ...a, [c.r.mov.id]: !(a[c.r.mov.id] ?? (c.estado === "difere" || c.estado === "vazio")) }))}
      candidatos={itensDoSistema}
      tomados={comps.tomados}
      onRetirar={(id) => editar(c, c.itens.filter((i) => i.id !== id).map((i) => i.id))}
      onAdicionar={(id) => escolher(c, id, null)}
      onTrocar={(de, para) => escolher(c, para, de)}
      onAjuste={(a) => editar(c, c.itens.map((i) => i.id), a)}
      onDesfazerEdicao={() => desfazerEdicao(c)}
      onConciliar={() => conciliar(c)}
    />
  );
  const linhaLivre = (c: Candidato) => (
    <LinhaSoNoSistema
      key={c.id}
      c={c}
      p={p}
      linhas={abertas2}
      onEditarData={editaData(c) ? () => setEditando(c) : null}
      onAssociar={(alvo) => editar(alvo, [...alvo.itens.map((i) => i.id), c.id], null)}
    />
  );
  const linhaConciliada = (r: ResultadoDaLinha) => <LinhaConciliada key={r.mov.id} r={r} p={p} />;

  const DICA_SO_SISTEMA =
    "O que o sistema tem neste dia e o banco não mostra: baixa já feita (até resolver, o dia não fecha), título em aberto previsto para o dia (de qualquer conta) e previsão da planilha. O lápis muda a data, como na aba Títulos. Associar leva o lançamento para uma linha do banco.";

  return (
    <>
      {(
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["todas", `Todas · ${comps.lista.length + conciliadas.length}`],
              ["pronto", `Prontas · ${prontas.length}`],
              ["conferir", `A definir · ${aConferir.length}`],
              ["sem", `${"Faltando"} · ${semLancamento.length}`],
              ["conciliadas", `Conciliadas · ${conciliadas.length}`],
            ] as Array<[Filtro, string]>
          ).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filtro === k}
              onClick={() => setFiltro(k)}
              className={cn("h-8 rounded-full border px-3 text-xs font-semibold", filtro === k ? "border-foreground bg-foreground text-white" : "border-border bg-white text-foreground hover:bg-muted/50")}
            >
              {rotulo}
            </button>
          ))}
          <span className="flex-1" />
          {botaoEmLote}
        </div>
      )}

      {/* O corte entre o banco e o sistema, e o realce do lado do sistema (onde o clique troca o lançamento).
          Por `dangerouslySetInnerHTML`: como texto, o ">" do seletor sai escapado no servidor e a hidratação falha. */}
      <style dangerouslySetInnerHTML={{ __html: CSS_DA_TABELA }} />
      <Saldos.Provider value={saldos}>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table style={{ minWidth: LARGURA }} className="comp-corte w-full table-fixed text-sm">
          <colgroup>
            {LARGURAS.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Descrição no banco</th>
              <th className="px-3 py-2 text-right">
                Valor
              </th>
              <th className="px-3 py-2 text-right" title="O saldo do banco depois de cada linha, na ordem do extrato.">
                Saldo
              </th>
              <th className="corte px-3 py-2 text-left">
                Data
              </th>
              <th className="px-3 py-2 text-right">
                Valor
              </th>
              <th className="px-3 py-2 text-left">No sistema · Descrição</th>
              <th className="px-3 py-2 text-left">Fornecedor</th>
              <th className="px-3 py-2 text-left">Job</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">TRI</th>
              <th className="px-3 py-2 text-left">Reg</th>
              <th className="px-3 py-2 text-left">
                Status
              </th>
              <th className="px-3 py-2 text-left">Ação</th>
            </tr>
          </thead>

          {
            [...comps.lista.map((c) => ({ id: c.r.mov.id as string, ordem: c.r.mov.ordem, data: c.r.mov.data, c, r: null as ResultadoDaLinha | null })), ...conciliadas.map((r) => ({ id: r.mov.id as string, ordem: r.mov.ordem, data: r.mov.data, c: null as Comp | null, r }))]
              .sort(naOrdemDoExtrato)
              .filter((x) =>
                filtro === "todas" ? true : filtro === "conciliadas" ? !!x.r : !!x.c && x.c.situacao === filtro,
              )
              .map((x) => (x.c ? linhaDaComp(x.c) : linhaConciliada(x.r as ResultadoDaLinha)))
          }

          {livres.length > 0 && (filtro === "todas" || filtro === "conferir" || filtro === "sem") && cabecalho("livres", "Só no sistema", livres.length, "bg-california-red", DICA_SO_SISTEMA)}
          {(filtro === "todas" || filtro === "conferir" || filtro === "sem") && !recolhidas.has("livres") && livres.map(linhaLivre)}

          {!comps.lista.length && !conciliadas.length && !livres.length && (
            <tbody>
              <tr>
                <td colSpan={COLUNAS} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma linha do banco neste dia.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      </Saldos.Provider>

      {movendo &&
        (() => {
          const item = porId.get(movendo.id);
          const origem = comps.porLinha.get(comps.tomados.get(movendo.id) ?? "");
          if (!item || !origem) return null;
          return (
            <MoverDeLinha
              item={item}
              origem={origem}
              destino={movendo.destino}
              trocarDe={movendo.trocarDe}
              onFechar={() => setMovendo(null)}
              onConfirmar={() => {
                aplicar(movendo.destino, movendo.id, movendo.trocarDe);
                setMovendo(null);
              }}
            />
          );
        })()}

      {/* O mesmo pop-up do lápis da aba Títulos. */}
      <EditarDataPagamentoDialog
        open={!!editando && !notaAReceber}
        onOpenChange={(o) => !o && setEditando(null)}
        alvo={
          editando && !notaAReceber
            ? {
                titulo: editando.descricao,
                origem:
                  editando.k === "baixa"
                    ? "Baixa já lançada no sistema"
                    : editando.k === "planilha"
                      ? "Previsão da planilha"
                      : lEdit?.lado === "pagar"
                        ? lEdit.t.origem === "pp"
                          ? `${lEdit.t.origem_label} · ${lEdit.t.parcela_numero}/${lEdit.t.parcela_total}`
                          : lEdit.t.origem_label
                        : (lEdit?.origem ?? "Título"),
                vencOriginal:
                  editando.k === "titulo"
                    ? ((lEdit?.lado === "pagar" ? lEdit.t.venc_original : lEdit?.vencimento) ?? null)
                    : editando.k === "planilha"
                      ? (editando.h.dataDaPlanilha ?? editando.data)
                      : null,
                primeiraData: editando.k === "titulo" && lEdit?.lado === "pagar" ? (lEdit.t.data_pagamento_primeira ?? null) : null,
                dataAtual: editando.data,
              }
            : null
        }
        pending={pending}
        erro={null}
        onSalvar={(d) => editando && salvarData(editando, d)}
      />
      <EditarPrevisaoDialog
        open={!!editando && !!notaAReceber}
        onOpenChange={(o) => !o && setEditando(null)}
        alvo={
          editando && notaAReceber
            ? {
                numeroNf: lEdit.t.fat_numero_nf,
                parcela: `${lEdit.t.numero_parcela}/${lEdit.t.total_parcelas}`,
                cliente: lEdit.t.contraparte_nome,
                vencimento: lEdit.t.data_vencimento,
                primeiraPrevisao: lEdit.t.data_previsao_recebimento_primeira,
                previsaoAtual: lEdit.t.data_previsao_recebimento,
              }
            : null
        }
        pending={pending}
        erro={null}
        onSalvar={(d) => editando && salvarData(editando, d)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// A confirmação de mover um lançamento de uma linha do banco para outra
// ---------------------------------------------------------------------------

/** Como a linha fica com estes lançamentos: fecha com o banco, falta ou sobra. */
function comoFica(r: ResultadoDaLinha, itens: Candidato[]): { texto: string; fecha: boolean } {
  const n = itens.length;
  if (!n) return { texto: "Fica sem lançamento", fecha: false };
  const soma = r2(itens.reduce((s, c) => s + c.valor, 0));
  const falta = r2(r.mov.valor - soma);
  const quantos = `Fica com ${n === 1 ? "1 lançamento" : `${n} lançamentos`}`;
  if (cents(falta) === 0) return { texto: `${quantos} · fecha com o banco`, fecha: true };
  return { texto: `${quantos} · ${Math.abs(r.mov.valor) > Math.abs(soma) ? "falta" : "sobra"} ${moeda(Math.abs(falta))}`, fecha: false };
}

function MoverDeLinha({ item, origem, destino, trocarDe, onFechar, onConfirmar }: { item: Candidato; origem: Comp; destino: Comp; trocarDe: string | null; onFechar: () => void; onConfirmar: () => void }) {
  const depoisNaOrigem = origem.itens.filter((i) => i.id !== item.id);
  const depoisNoDestino = trocarDe ? destino.itens.map((i) => (i.id === trocarDe ? item : i)) : [...destino.itens, item];
  const sai = trocarDe ? destino.itens.find((i) => i.id === trocarDe) : null;
  const caixa = (rotulo: string, c: Comp, itens: Candidato[], tom: string) => {
    const f = comoFica(c.r, itens);
    return (
      <div className={cn("rounded-lg border px-3 py-2.5", tom)}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{rotulo}</div>
        <div className="mt-1 grid grid-cols-[48px_1fr_auto] items-baseline gap-3 text-sm">
          <span className="font-mono text-xs font-semibold">{ddmm(c.r.mov.data)}</span>
          <span className="min-w-0 truncate font-mono text-[11px]" title={c.r.mov.historico}>
            {c.r.mov.historico}
          </span>
          <span className={cn("whitespace-nowrap font-mono text-xs font-semibold", c.r.mov.valor < 0 ? "text-california-red" : "text-emerald-700")}>{comSinal(c.r.mov.valor)}</span>
        </div>
        <div className={cn("mt-1 text-xs", f.fecha ? "text-emerald-700" : "text-amber-800")}>{f.texto}</div>
      </div>
    );
  };
  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Tem certeza? O lançamento já está em outra linha</DialogTitle>
          <DialogDescription>Nada é gravado até você conciliar.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-muted/50 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-sm font-semibold">{item.descricao}</span>
            <span className={cn("whitespace-nowrap font-mono text-xs font-semibold", item.valor < 0 ? "text-california-red" : "text-emerald-700")}>{comSinal(item.valor)}</span>
          </div>
          {item.quem && <div className="text-xs text-muted-foreground">{item.quem}</div>}
        </div>
        <div className="space-y-1.5">
          {caixa("Sai de", origem, depoisNaOrigem, "border-border bg-white")}
          <div className="flex justify-center text-muted-foreground">
            <ArrowDown className="h-4 w-4" />
          </div>
          {caixa("Vai para", destino, depoisNoDestino, "border-california-red/40 bg-california-red/5")}
          {sai && (
            <div className="px-1 text-xs text-muted-foreground">
              <strong className="font-semibold text-foreground">{sai.descricao}</strong> volta para “Só no sistema”.
            </div>
          )}
        </div>
        <DialogFooter>
          <button type="button" onClick={onFechar} className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold hover:bg-muted">
            Cancelar
          </button>
          <button type="button" onClick={onConfirmar} className="inline-flex h-9 items-center gap-2 rounded-lg bg-california-red px-3 text-sm font-semibold text-white hover:opacity-90">
            Sim, mover
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A coluna Status e a Ação (sempre as mesmas)
// ---------------------------------------------------------------------------

function Situacao({ c }: { c: Comp }) {
  const detalhe = (t: React.ReactNode) => <span className="block text-[10px] font-normal leading-tight">{t}</span>;
  if (c.situacao === "pronto")
    return (
      <span className="block text-xs font-semibold leading-tight text-emerald-700">
        <span className="inline-flex items-center gap-1">
          <CheckCheck className="h-3.5 w-3.5" />
          Pronto
        </span>
        {c.estado === "ajuste" && detalhe(c.ajuste === "parcial" ? `baixa parcial: fica ${moeda(Math.abs(c.falta))} em aberto` : `${ROTULO_DO_AJUSTE[c.ajuste as Ajuste]}: ${moeda(Math.abs(c.falta))}`)}
      </span>
    );
  if (c.situacao === "sem")
    return (
      <span className="text-xs font-semibold text-california-red" title="O sistema não tem nada com esse valor, nem em outras datas.">
        {"Faltando"}
      </span>
    );
  const bancoMaior = Math.abs(c.r.mov.valor) > Math.abs(c.soma);
  return (
    <span
      className="block text-xs font-semibold leading-tight text-amber-700"
      title={
        c.estado === "difere"
          ? bancoMaior
            ? "O banco tem mais do que a soma dos lançamentos do sistema."
            : "A soma dos lançamentos do sistema passa do valor do banco."
          : c.iguaisNoDia
            ? "O sistema tem mais de um lançamento possível para esta linha: escolha."
            : "O sistema tem esse valor em outra data: confira se é este pagamento."
      }
    >
      A definir
      {detalhe(
        c.estado === "difere"
          ? `${bancoMaior ? "falta" : "sobra"} ${moeda(Math.abs(c.falta))}`
          : c.iguaisNoDia
            ? `${c.iguaisNoDia} de ${moeda(Math.abs(c.r.mov.valor))} no dia`
            : `${c.emOutraData} em ${c.emOutraData === 1 ? "outra data" : "outras datas"}`,
      )}
    </span>
  );
}

function BotaoConciliar({ habilitado, motivo, onClick, ocupado }: { habilitado: boolean; motivo: string; onClick: () => void; ocupado: boolean }) {
  return (
    <button type="button" disabled={!habilitado || ocupado} onClick={onClick} title={habilitado ? "Concilia a linha do banco com os lançamentos do sistema ao lado." : motivo} aria-label="Conciliar" className={cn(habilitado ? VERDE : CONTORNO, BOTAO_DA_ACAO, "disabled:cursor-not-allowed disabled:opacity-50")}>
      <CheckCheck className="h-3 w-3" />
      Conciliar
    </button>
  );
}

// ---------------------------------------------------------------------------
// A linha do banco com os lançamentos dela
// ---------------------------------------------------------------------------

function CelulasDoItem({
  c,
  p,
  dataDoBanco,
  onRetirar,
  onAbrir,
  primeira,
  toggle,
  campo,
}: {
  c: Candidato;
  p: PropsDaFila;
  dataDoBanco: string;
  onRetirar: () => void;
  /** Clicar em qualquer ponto do lado do sistema abre a troca do lançamento. */
  onAbrir: () => void;
  primeira: boolean;
  toggle: React.ReactNode;
  /** O campo do lançamento: a âncora da lista de troca. */
  campo: React.ReactNode;
}) {
  const e = extras(c, p);
  const outraData = c.data !== dataDoBanco;
  const SIS = "sis cursor-pointer";
  return (
    <>
      <td onClick={onAbrir} className={cn("corte whitespace-nowrap font-mono text-xs", SIS, CEL)}>
        <span className="flex items-start gap-1">
          {primeira ? <span onClick={(ev) => ev.stopPropagation()}>{toggle}</span> : <span className="inline-block w-5 shrink-0" />}
          <span className="leading-tight">
            {outraData ? (
              <span className="font-semibold text-amber-700" title={`O lançamento é de ${ddmm(c.data)}: ao conciliar, passa a ter a data do banco, ${ddmm(dataDoBanco)}.`}>
                {ddmm(c.data)} → {ddmm(dataDoBanco)}
              </span>
            ) : (
              ddmm(c.data)
            )}
            <span className="block font-sans text-[10px] text-muted-foreground">{ROTULO_DO_TIPO[c.k]}</span>
          </span>
        </span>
      </td>
      <td onClick={onAbrir} className={cn("whitespace-nowrap text-right font-mono text-xs", SIS, CEL, c.valor < 0 ? "text-california-red" : "text-emerald-700")}>
        {comSinal(c.valor)}
      </td>
      <td onClick={onAbrir} className={cn("text-xs", SIS, CEL)}>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onRetirar();
            }}
            title="Retirar este lançamento desta linha do banco. Ele volta para Só no sistema."
            aria-label="Retirar este lançamento"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-red-50 hover:text-california-red"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {campo}
        </span>
      </td>
      <td onClick={onAbrir} className={cn("text-xs", SIS, CEL)}>
        <TxtPassivo t={c.quem} />
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SIS, CEL)}>
        <TxtPassivo t={e.job} />
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SIS, CEL)}>
        {e.tipo ?? <Traco />}
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SIS, CEL)}>
        {e.tri}
      </td>
      <td onClick={onAbrir} className={cn("font-mono text-[11px]", SIS, CEL)}>
        {e.reg ?? <Traco />}
      </td>
    </>
  );
}

function LinhaDoBanco({
  c,
  p,
  aberta,
  alternar,
  candidatos,
  tomados,
  onRetirar,
  onAdicionar,
  onTrocar,
  onAjuste,
  onDesfazerEdicao,
  onConciliar,
}: {
  c: Comp;
  p: PropsDaFila;
  aberta: boolean;
  alternar: () => void;
  candidatos: Candidato[];
  tomados: Map<string, string>;
  onRetirar: (id: string) => void;
  onAdicionar: (id: string) => void;
  onTrocar: (de: string, para: string) => void;
  onAjuste: (a: Ajuste | null) => void;
  onDesfazerEdicao: () => void;
  onConciliar: () => void;
}) {
  const r = c.r;
  const n = c.itens.length;
  // O lançamento com a lista de troca aberta (clicar em qualquer célula dele abre).
  const [trocando, setTrocando] = React.useState<string | null>(null);
  const resumida = !aberta && n > 1;
  const linhasDoSistema = c.especial ? 1 : resumida ? 1 : Math.max(n, aberta ? 0 : 1);
  const comRodape = aberta && !c.especial;
  const span = linhasDoSistema + (comRodape ? 1 : 0) || 1;
  const toggle = (
    <button type="button" onClick={alternar} aria-expanded={aberta} title={aberta ? "Recolher os lançamentos desta linha" : "Abrir os lançamentos desta linha: retirar, adicionar ou trocar"} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
      {aberta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </button>
  );
  const possiveis = ajustesPossiveis(c);
  // Para a linha sem lançamento: o que existe com o mesmo valor a até 7 dias.
  const noDiaIguais = c.iguaisNoDia;
  const emOutraData = c.emOutraData;
  const quem = [...new Set(c.itens.map((i) => i.quem).filter(Boolean))];
  const motivo = c.estado === "vazio" ? "Adicione o lançamento do sistema que esta linha do banco paga, ou lance um novo." : `A soma do sistema é ${moeda(Math.abs(c.soma))} e o banco tem ${moeda(Math.abs(r.mov.valor))}: adicione, retire ou ajuste.`;
  const menu: AcaoDescrita[] = [
    { rotulo: "Lançar avulso", dica: "Nada no sistema corresponde: cria o lançamento a partir desta linha.", icone: FilePlus2, onClick: () => p.acoes.lancarAvulso(r) },
    { rotulo: "Criar uma regra para este histórico", icone: Wand2, onClick: () => p.acoes.criarRegra(r) },
    ...(c.editada ? [{ rotulo: "Voltar à sugestão do sistema", icone: RotateCcw, onClick: onDesfazerEdicao }] : []),
    { rotulo: "Ignorar esta linha", icone: CircleSlash, onClick: () => p.acoes.ignorar(r), perigo: true },
  ];

  const celulasDoBanco = (
    <>
      <td rowSpan={span} className={cn("whitespace-nowrap align-top font-mono text-xs", CEL)}>
        {ddmm(r.mov.data)}
      </td>
      <td rowSpan={span} className={cn("align-top font-mono text-[11px]", CEL)}>
        <Txt t={r.mov.historico} />
      </td>
      <td rowSpan={span} className={cn("whitespace-nowrap text-right align-top font-mono text-xs", CEL, r.mov.valor < 0 ? "text-california-red" : "text-emerald-700")}>
        {comSinal(r.mov.valor)}
      </td>
      <CelulaDoSaldo id={r.mov.id} rowSpan={span} />
    </>
  );
  const celulasDoFim = (
    <>
      <td rowSpan={span} className={cn("align-top", CEL)}>
        <Situacao c={c} />
      </td>
      <td rowSpan={span} className={cn("align-top", CEL)}>
        <span className="flex items-center justify-end gap-1">
          <BotaoConciliar habilitado={c.estado === "bate" || c.estado === "ajuste"} motivo={motivo} onClick={onConciliar} ocupado={p.pending} />
          <Menu itens={menu} ocupado={p.pending} />
        </span>
      </td>
    </>
  );

  const rodape = comRodape && (
    <tr className="border-b border-border">
      <td colSpan={8} className="corte px-3 py-2">
        <span className="flex flex-wrap items-center gap-2 pl-6">
          <Adicionar c={c} p={p} candidatos={candidatos} tomados={tomados} onAdicionar={onAdicionar} onLancar={() => p.acoes.lancarAvulso(r)} />
          {(c.estado === "difere" || c.estado === "ajuste") &&
            possiveis.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={c.ajuste === a}
                onClick={() => onAjuste(c.ajuste === a ? null : a)}
                className={cn("h-7 rounded-md border px-2 text-[11px] font-semibold", c.ajuste === a ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100")}
              >
                {a === "juros" && `Lançar ${moeda(Math.abs(c.falta))} como juros e multa`}
                {a === "retencao" && `${moeda(Math.abs(c.falta))} de retenção na fonte`}
                {a === "parcial" && `Baixa parcial: pagar ${moeda(parteDoUltimo(c))} ${n > 1 ? "do último título" : "deste título"}`}
                {a === "correcao" && `Corrigir a baixa para ${moeda(Math.abs(r.mov.valor))}`}
              </button>
            ))}
          {c.estado === "difere" && !possiveis.length && n > 0 && <span className="text-[11px] text-amber-800">{Math.abs(r.mov.valor) > Math.abs(c.soma) ? "Falta lançamento: adicione o que completa." : "Sobra lançamento: retire o que não é desta linha."}</span>}
        </span>
      </td>
    </tr>
  );

  // O que o sistema resolve sem lançamento existente (tarifa pela regra, PIX que voltou, mútuo).
  if (c.especial)
    return (
      <tbody data-comp="">
        <tr className="border-b border-border hover:bg-muted/30">
          {celulasDoBanco}
          <td className={cn("corte whitespace-nowrap font-mono text-xs", CEL)}>
            <span className="flex items-start gap-1">
              <span className="inline-block w-5 shrink-0" />
              <span className="leading-tight">
                {ddmm(r.mov.data)}
                <span className="block font-sans text-[10px] text-muted-foreground">{c.especial.k === "regra" ? "a lançar" : c.especial.k === "mutuo" ? "a lançar" : "sem baixa"}</span>
              </span>
            </span>
          </td>
          <td className={cn("whitespace-nowrap text-right font-mono text-xs", CEL, r.mov.valor < 0 ? "text-california-red" : "text-emerald-700")}>{comSinal(r.mov.valor)}</td>
          <td className={cn("text-xs", CEL)} colSpan={6}>
            <Txt t={c.especial.texto} />
          </td>
          {celulasDoFim}
        </tr>
      </tbody>
    );

  return (
    <tbody data-comp="">
      {resumida ? (
        <tr className="border-b border-border hover:bg-muted/30">
          {celulasDoBanco}
          <td onClick={alternar} className={cn("corte sis cursor-pointer whitespace-nowrap font-mono text-xs", CEL)}>
            <span className="flex items-start gap-1">
              <span onClick={(ev) => ev.stopPropagation()}>{toggle}</span>
              <span className="leading-tight">
                {[...new Set(c.itens.map((i) => i.data))].length === 1 ? ddmm(c.itens[0].data) : "várias"}
                <span className="block font-sans text-[10px] text-muted-foreground">{[...new Set(c.itens.map((i) => ROTULO_DO_TIPO[i.k]))].join(" + ")}</span>
              </span>
            </span>
          </td>
          <td onClick={alternar} className={cn("sis cursor-pointer whitespace-nowrap text-right font-mono text-xs", CEL, c.soma < 0 ? "text-california-red" : "text-emerald-700")}>
            {comSinal(c.soma)}
          </td>
          <td onClick={alternar} className={cn("sis cursor-pointer text-xs", CEL)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="block w-full truncate text-left font-semibold underline decoration-dotted underline-offset-2">
                  {n} lançamentos
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[560px]">
                {c.itens.map((i) => (
                  <span key={i.id} className="block">
                    {ddmm(i.data)} · {i.descricao} · <span className="font-mono">{moeda(Math.abs(i.valor))}</span>
                  </span>
                ))}
                <span className="mt-1 block text-muted-foreground">Clique para abrir e mexer em cada um.</span>
              </TooltipContent>
            </Tooltip>
          </td>
          <td onClick={alternar} className={cn("sis cursor-pointer text-xs", CEL)}>
            <TxtPassivo t={quem.length === 1 ? quem[0] : quem.length ? `${quem.length} fornecedores: ${quem.join(", ")}` : null} />
          </td>
          <td onClick={alternar} className={cn("sis cursor-pointer", CEL)} colSpan={4}>
            <Traco />
          </td>
          {celulasDoFim}
        </tr>
      ) : n === 0 ? (
        // Sem lançamento: só o rodapé, com o adicionar.
        <tr className="border-b border-border">
          {celulasDoBanco}
          <td colSpan={8} className="corte px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <Adicionar c={c} p={p} candidatos={candidatos} tomados={tomados} onAdicionar={onAdicionar} onLancar={() => p.acoes.lancarAvulso(r)} />
              <span className={cn("text-[11px]", noDiaIguais || emOutraData ? "font-semibold text-amber-800" : "text-muted-foreground")}>
                {noDiaIguais
                  ? noDiaIguais === 1
                    ? `Há 1 lançamento de ${moeda(Math.abs(r.mov.valor))} no dia: confira se é o desta linha.`
                    : `Há ${noDiaIguais} lançamentos de ${moeda(Math.abs(r.mov.valor))} no dia: escolha o desta linha.`
                  : emOutraData
                    ? `Nada no dia. Há ${emOutraData} com esse valor em ${emOutraData === 1 ? "outra data" : "outras datas"}.`
                    : "Nenhum lançamento do sistema neste dia com esse valor."}
              </span>
            </span>
          </td>
          {celulasDoFim}
        </tr>
      ) : (
        c.itens.map((i, k) => (
          <tr key={i.id} className={cn("hover:bg-muted/30", k === n - 1 && !comRodape ? "border-b border-border" : "border-b border-border/40")}>
            {k === 0 && celulasDoBanco}
            <CelulasDoItem
              c={i}
              p={p}
              dataDoBanco={r.mov.data}
              onRetirar={() => onRetirar(i.id)}
              onAbrir={() => setTrocando(i.id)}
              primeira={k === 0}
              toggle={toggle}
              campo={
                <Adicionar
                  c={c}
                  p={p}
                  candidatos={candidatos}
                  tomados={tomados}
                  trocando={i}
                  aberto={trocando === i.id}
                  setAberto={(o) => setTrocando(o ? i.id : null)}
                  onAdicionar={(id) => onTrocar(i.id, id)}
                  onRetirar={() => onRetirar(i.id)}
                  onLancar={() => p.acoes.lancarAvulso(r)}
                />
              }
            />
            {k === 0 && celulasDoFim}
          </tr>
        ))
      )}
      {n > 0 && rodape}
    </tbody>
  );
}

// ---------------------------------------------------------------------------
// Adicionar um lançamento à linha (a busca, no próprio lugar)
// ---------------------------------------------------------------------------

function Adicionar({
  c,
  candidatos,
  tomados,
  onAdicionar,
  onLancar,
  trocando,
  onRetirar,
  aberto: abertoDeFora,
  setAberto: setAbertoDeFora,
  p,
}: {
  c: Comp;
  candidatos: Candidato[];
  tomados: Map<string, string>;
  onAdicionar: (id: string) => void;
  onLancar: () => void;
  /** O lançamento que está sendo trocado: o gatilho é o próprio campo dele. */
  trocando?: Candidato;
  onRetirar?: () => void;
  /** Aberto por fora: a linha inteira do lançamento abre a lista. */
  aberto?: boolean;
  setAberto?: (o: boolean) => void;
  p: PropsDaFila;
}) {
  const [abertoLocal, setAbertoLocal] = React.useState(false);
  const aberto = abertoDeFora ?? abertoLocal;
  const setAberto = setAbertoDeFora ?? setAbertoLocal;
  const [texto, setTexto] = React.useState("");
  const [janela, setJanela] = React.useState(7);
  const campo = React.useRef<HTMLInputElement>(null);
  // A lista abre embaixo do lado do sistema inteiro (da coluna Data à Reg) e usa
  // as mesmas larguras das colunas da tabela: cada campo cai embaixo do seu.
  const gatilho = React.useRef<HTMLButtonElement>(null);
  const colunasDoSistema = () => [...(gatilho.current?.closest("table")?.querySelectorAll("thead th") ?? [])].slice(SISTEMA_DE, SISTEMA_ATE) as HTMLElement[];
  const ancora = React.useRef({
    getBoundingClientRect: () => {
      const ths = colunasDoSistema();
      const tr = gatilho.current?.closest("tr")?.getBoundingClientRect() ?? gatilho.current?.getBoundingClientRect();
      if (!ths.length || !tr) return gatilho.current?.getBoundingClientRect() ?? new DOMRect();
      const a = ths[0].getBoundingClientRect();
      const b = ths[ths.length - 1].getBoundingClientRect();
      return new DOMRect(a.left, tr.top, b.right - a.left, tr.height);
    },
  });
  const [larguras, setLarguras] = React.useState<number[]>([104, 114, 250, 148, 104, 50, 44, 48]);
  React.useLayoutEffect(() => {
    if (!aberto) return;
    const ws = colunasDoSistema().map((th) => th.offsetWidth);
    if (ws.length === 8 && ws.every((w) => w > 0)) setLarguras(ws);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  const grade = { gridTemplateColumns: larguras.map((w) => `${w}px`).join(" ") };
  const mov = c.r.mov;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const naLinha = new Set(c.itens.map((i) => i.id));
  // Na troca, a conta é a da linha sem o lançamento que sai.
  const outros = trocando ? c.itens.filter((i) => i.id !== trocando.id) : c.itens;
  const falta = trocando ? r2(c.falta + trocando.valor) : c.falta;
  const temPlanilha = outros.some((i) => i.k === "planilha");
  const temOutros = outros.some((i) => i.k !== "planilha");
  const lista = React.useMemo(() => {
    const q = norm(texto.trim());
    const fornecedores = new Set((trocando ? [trocando, ...outros] : outros).map((i) => i.quem).filter(Boolean));
    return candidatos
      .filter((x) => !naLinha.has(x.id) && Math.sign(x.valor) === Math.sign(mov.valor) && Math.abs(diasEntre(mov.data, x.data)) <= janela)
      .filter((x) => (temPlanilha ? x.k === "planilha" : temOutros ? x.k !== "planilha" : true))
      .filter((x) => !q || norm(`${x.descricao} ${x.quem ?? ""} ${moeda(Math.abs(x.valor))}`).includes(q))
      .map((x) => ({ x, fecha: cents(x.valor) === cents(falta) && Math.sign(x.valor) === Math.sign(falta), mesmo: !!x.quem && fornecedores.has(x.quem), dias: Math.abs(diasEntre(mov.data, x.data)) }))
      .sort((a, b) => Number(b.fecha) - Number(a.fecha) || a.dias - b.dias || Number(b.mesmo) - Number(a.mesmo) || Math.abs(b.x.valor) - Math.abs(a.x.valor))
      .slice(0, 40);
  }, [candidatos, texto, janela, c.itens, falta, mov, trocando?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Primeiro o que fecha a conta, depois o que é do mesmo fornecedor; o resto, pelo dia.
  const queFecha = lista.filter((i) => i.fecha);
  const doMesmo = lista.filter((i) => !i.fecha && i.mesmo);
  const doDia = lista.filter((i) => !i.fecha && !i.mesmo && i.dias === 0);
  const deFora = lista.filter((i) => !i.fecha && !i.mesmo && i.dias !== 0);
  const titulo = (t: string) => <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t}</div>;
  // Cada célula com o mesmo recuo das células da tabela.
  const GRADE = "grid items-center [&>span]:min-w-0 [&>span]:px-3";
  const linha = ({ x, fecha }: (typeof lista)[number]) => {
    const e = extras(x, p);
    return (
      <button
        key={x.id}
        type="button"
        onClick={() => {
          onAdicionar(x.id);
          setAberto(false);
          setTexto("");
        }}
        style={grade}
        className={cn(GRADE, "w-full border-b border-border/40 py-1.5 text-left text-xs hover:bg-muted")}
      >
        <span className="leading-tight">
          <span className="font-mono font-semibold">{ddmm(x.data)}</span>
          <span className="block text-[10px] text-muted-foreground">{ROTULO_DO_TIPO[x.k]}</span>
        </span>
        <span className={cn("whitespace-nowrap text-right font-mono", x.valor < 0 ? "text-california-red" : "text-emerald-700")}>{comSinal(x.valor)}</span>
        <span>
          <TxtPassivo
            acima
            t={x.descricao}
            dica={[fecha ? "Com este lançamento, a soma fecha com o banco." : null, tomados.has(x.id) ? "Está em outra linha do banco: se usar aqui, sai de lá." : null].filter(Boolean).join(" ") || undefined}
          >
            {fecha && <span className="mr-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-800">fecha a conta</span>}
            {x.descricao}
          </TxtPassivo>
        </span>
        <span>
          <TxtPassivo acima t={x.quem} />
        </span>
        <span className="font-mono text-[11px]">
          <TxtPassivo acima t={e.job} />
        </span>
        <span className="font-mono text-[11px]">{e.tipo ?? "—"}</span>
        <span className="font-mono text-[11px]">{e.tri}</span>
        <span className="font-mono text-[11px]">{e.reg ?? "—"}</span>
      </button>
    );
  };
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      {trocando ? (
        <Tooltip open={aberto ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                ref={gatilho}
                aria-label={`Trocar o lançamento: ${trocando.descricao}`}
                onClick={(ev) => ev.stopPropagation()}
                className={cn("flex min-w-0 flex-1 items-center gap-1 rounded-md border px-1.5 py-0.5 text-left hover:border-border hover:bg-white", aberto ? "border-california-red/50 bg-white" : "border-transparent")}
              >
                <span className="min-w-0 flex-1 truncate">{trocando.descricao}</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-[560px]">
            {trocando.descricao}
            <span className="mt-1 block text-muted-foreground">Clique para trocar por outro lançamento.</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>
          <button ref={gatilho} type="button" className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2 text-[11px] font-semibold hover:bg-muted">
            <Plus className="h-3 w-3" />
            Adicionar lançamento
          </button>
        </PopoverTrigger>
      )}
      <PopoverAnchor virtualRef={ancora as never} />
      <PopoverContent
        align="start"
        sideOffset={2}
        style={{ width: larguras.reduce((t, w) => t + w, 0) + 2 }}
        className="overflow-hidden p-0"
        onClick={(ev) => ev.stopPropagation()}
        // O foco vai para a busca sem rolar a página (no visualizador, o foco comum pulava para o topo).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          campo.current?.focus({ preventScroll: true });
        }}
      >
        {trocando && (
          <div className="flex items-center gap-2 bg-muted/60 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1">
              <TxtPassivo acima t={trocando.descricao}>
                Trocar <strong>{trocando.descricao}</strong> por:
              </TxtPassivo>
            </span>
            {onRetirar && (
              <button
                type="button"
                onClick={() => {
                  setAberto(false);
                  onRetirar();
                }}
                className="inline-flex shrink-0 items-center gap-1 font-semibold text-california-red hover:underline"
              >
                <X className="h-3.5 w-3.5" />
                Só retirar da linha
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <input ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Fornecedor, descrição ou valor" className="h-8 w-full rounded-lg border border-border bg-white pl-8 pr-3 text-xs" />
          </span>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {[7, 30].map((j) => (
              <button key={j} type="button" onClick={() => setJanela(j)} aria-pressed={janela === j} className={cn("h-8 px-2.5 text-[11px] font-semibold", janela === j ? "bg-foreground text-white" : "bg-white hover:bg-muted")}>
                ± {j} dias
              </button>
            ))}
          </div>
        </div>
        <div style={grade} className={cn(GRADE, "border-y border-border bg-muted/40 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground")}>
          <span>Data</span>
          <span className="text-right">Valor</span>
          <span>No sistema · Descrição</span>
          <span>Fornecedor</span>
          <span>Job</span>
          <span>Tipo</span>
          <span>TRI</span>
          <span>Reg</span>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {queFecha.length > 0 && titulo("Fecha a conta")}
          {queFecha.map(linha)}
          {doMesmo.length > 0 && titulo("Do mesmo fornecedor")}
          {doMesmo.map(linha)}
          {doDia.length > 0 && titulo(`No dia ${ddmm(mov.data)}`)}
          {doDia.map(linha)}
          {deFora.length > 0 && titulo("Em outras datas · passam a ter a data do banco")}
          {deFora.map(linha)}
          {!lista.length && <div className="px-3 py-5 text-center text-xs text-muted-foreground">Nada no sistema em ± {janela} dias com esse texto.</div>}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            {trocando ? "Para fechar a conta, o novo lançamento precisa ter" : "Falta fechar"}: <strong className="font-mono text-foreground">{moeda(Math.abs(falta))}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              onLancar();
            }}
            className="inline-flex items-center gap-1.5 font-semibold text-foreground underline underline-offset-2"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Não está no sistema: lançar avulso
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Só no sistema e Conciliados
// ---------------------------------------------------------------------------

function LinhaSoNoSistema({ c, p, linhas, onEditarData, onAssociar }: { c: Candidato; p: PropsDaFila; linhas: Comp[]; /** Nulo: a data deste lançamento não muda por aqui. */ onEditarData: (() => void) | null; onAssociar: (alvo: Comp) => void }) {
  const [aberto, setAberto] = React.useState(false);
  const e = extras(c, p);
  const l = c.k === "titulo" ? p.contexto.linhaPorChave.get(c.t.id) : undefined;
  const venc = l?.vencimento && l.vencimento !== c.data ? l.vencimento : null;
  // A previsão com a data ajustada pela tela mostra a da planilha embaixo.
  const daPlanilha = c.k === "planilha" && c.h.dataDaPlanilha && c.h.dataDaPlanilha !== c.data ? c.h.dataDaPlanilha : null;
  const alvos = linhas.filter((x) => Math.sign(x.r.mov.valor) === Math.sign(c.valor));
  const menu: AcaoDescrita[] =
    c.k === "baixa" && c.l.cancelamento ? [{ rotulo: "Cancelar baixa", dica: "O banco não mostra este pagamento: cancela a baixa e o título volta a ficar em aberto.", icone: Undo2, onClick: () => p.acoes.cancelarBaixa(c.l), perigo: true }] : [];
  return (
    <tbody data-comp="">
      <tr className={cn("border-b border-border hover:bg-muted/30", c.k === "baixa" && "bg-red-50/30")}>
        <td colSpan={SISTEMA_DE} className="px-3 py-2 text-[11px] italic text-muted-foreground">
          sem linha no banco
        </td>
        <td className={cn("corte whitespace-nowrap font-mono text-xs", CEL)}>
          <span className="inline-flex items-start gap-1.5">
            <button type="button" onClick={onEditarData ?? undefined} disabled={!onEditarData} title={!onEditarData ? "A data deste lançamento ainda não muda por aqui: mude na tela dele." : c.k === "baixa" ? "Editar a data da baixa" : c.k === "planilha" ? "Editar a data da previsão" : "Editar data prevista de pagamento"} aria-label="Editar a data" className="rounded p-0.5 text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-muted hover:text-california-red">
              <Pencil className="h-3 w-3" />
            </button>
            <span className="leading-tight">
              {ddmm(c.data)}
              {venc && <span className="block font-sans text-[10px] text-amber-700">venc. {ddmm(venc)}</span>}
              {daPlanilha && <span className="block font-sans text-[10px] text-amber-700">planilha {ddmm(daPlanilha)}</span>}
            </span>
          </span>
        </td>
        <td className={cn("whitespace-nowrap text-right font-mono text-xs", CEL, c.valor < 0 ? "text-california-red" : "text-emerald-700")}>{comSinal(c.valor)}</td>
        <td className={cn("text-xs", CEL)}>
          <Txt t={c.descricao} />
        </td>
        <td className={cn("text-xs", CEL)}>
        <Txt t={c.quem} />
      </td>
        <td className={cn("truncate font-mono text-[11px]", CEL)}>{e.job ?? <Traco />}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{e.tipo ?? <Traco />}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{e.tri}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{e.reg ?? <Traco />}</td>
        <td className={CEL}>
          <span
            className={cn("text-xs font-semibold", c.k === "baixa" ? "text-california-red" : "text-muted-foreground")}
            title={c.k === "baixa" ? "Baixa já lançada no sistema neste dia, sem linha no banco. Até resolver, o dia não fecha." : c.k === "titulo" ? "Título previsto para este dia, ainda em aberto. Não impede o fechamento." : "Previsão da planilha para este dia. Não impede o fechamento."}
          >
            {c.k === "baixa" ? "Sem linha" : c.k === "titulo" ? "Em aberto" : "Planilha"}
          </span>
        </td>
        <td className={CEL}>
          <span className="flex items-center justify-end gap-1">
            <Popover open={aberto} onOpenChange={setAberto}>
              <PopoverTrigger asChild>
                <button type="button" title="Leva este lançamento para uma linha do banco deste dia." aria-label="Associar" className={cn(CONTORNO, BOTAO_DA_ACAO)}>
                  <Link2 className="h-3 w-3" />
                  Associar
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[470px] p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
                <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Linhas do banco a definir ou {"faltando"}</div>
                {alvos.map((x) => (
                  <button
                    key={x.r.mov.id}
                    type="button"
                    onClick={() => {
                      setAberto(false);
                      onAssociar(x);
                    }}
                    className="grid w-full grid-cols-[50px_1fr_112px_132px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span className="font-mono font-semibold">{ddmm(x.r.mov.data)}</span>
                    <span className="truncate font-mono text-[11px]" title={x.r.mov.historico}>
                      {x.r.mov.historico}
                    </span>
                    <span className="text-right font-mono">{comSinal(x.r.mov.valor)}</span>
                    <span className="text-right text-[11px] text-amber-800">{x.estado === "vazio" ? "faltando" : `${Math.abs(x.r.mov.valor) > Math.abs(x.soma) ? "falta" : "sobra"} ${moeda(Math.abs(x.falta))}`}</span>
                  </button>
                ))}
                {!alvos.length && <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhuma linha do banco deste dia está a definir ou {"faltando"}.</div>}
              </PopoverContent>
            </Popover>
            <Menu itens={menu} ocupado={p.pending} />
          </span>
        </td>
      </tr>
    </tbody>
  );
}

function LinhaConciliada({ r, p }: { r: ResultadoDaLinha; p: PropsDaFila }) {
  const item: Item = { k: "linha", id: r.mov.id, data: r.mov.data, tipo: "conciliado", r };
  const t = celulasDoItem(item, { contexto: p.contexto, banco: p.banco });
  const ignorada = r.resolvido?.estado === "ignorado";
  return (
    <tbody data-comp="">
      <tr className="border-b border-border text-muted-foreground hover:bg-muted/30">
        <td className={cn("whitespace-nowrap font-mono text-xs", CEL)}>{ddmm(r.mov.data)}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>
          <Txt t={r.mov.historico} />
        </td>
        <td className={cn("whitespace-nowrap text-right font-mono text-xs", CEL)}>
          {comSinal(r.mov.valor)}
        </td>
        <CelulaDoSaldo id={r.mov.id} apagada />
        <td className={cn("corte whitespace-nowrap font-mono text-xs", CEL)}>{ignorada ? <Traco /> : ddmm(r.mov.data)}</td>
        <td className={cn("whitespace-nowrap text-right font-mono text-xs", CEL)}>{ignorada ? <Traco /> : comSinal(r.mov.valor)}</td>
        <td className={cn("text-xs", CEL)}>
          <Txt t={t.sistema} />
        </td>
        <td className={cn("text-xs", CEL)}>
          <Txt t={t.quem} />
        </td>
        <td className={cn("truncate font-mono text-[11px]", CEL)}>{t.job ?? <Traco />}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{t.tipo ?? <Traco />}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{t.tri}</td>
        <td className={cn("font-mono text-[11px]", CEL)}>{t.reg ?? <Traco />}</td>
        <td className={CEL}>
          <span className="inline-flex items-center gap-1 text-xs font-semibold">
            <CheckCheck className="h-3.5 w-3.5" />
            {ignorada ? "Ignorada" : "Conciliada"}
          </span>
        </td>
        <td className={CEL}>
          <span className="flex items-center justify-end gap-1">
            <button type="button" disabled={p.pending} onClick={() => p.acoes.desfazer(r)} title="Desfaz a conciliação: a linha e os lançamentos voltam para a conferência." aria-label="Desfazer" className={cn(CONTORNO, BOTAO_DA_ACAO)}>
              <Undo2 className="h-3 w-3" />
              Desfazer
            </button>
            <span className="inline-block h-7 w-7 shrink-0" />
          </span>
        </td>
      </tr>
    </tbody>
  );
}

/** O texto cortado com o texto inteiro ao passar o mouse, sem tomar o clique
 *  (a célula inteira é clicável). */
function TxtPassivo({
  t,
  className,
  children,
  dica,
  acima,
}: {
  t: string | null | undefined;
  className?: string;
  /** O que aparece na célula, quando não é só o texto (o texto com selos). */
  children?: React.ReactNode;
  /** O que a dica diz além do texto inteiro. */
  dica?: React.ReactNode;
  /** A dica acima de um pop-up aberto (a lista de escolha). */
  acima?: boolean;
}) {
  if (!t) return <Traco />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("block w-full truncate", className)}>{children ?? t}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className={cn("max-w-[560px]", acima && "z-[80]")}>
        {t}
        {dica && <span className="mt-1 block text-muted-foreground">{dica}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** O ⋯ da linha: sempre os mesmos itens (a vaga fica, mesmo vazia). */
function Menu({ itens, ocupado }: { itens: AcaoDescrita[]; ocupado: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  if (!itens.length) return <span className="inline-block h-7 w-7 shrink-0" />;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Mais ações" title="Mais ações" disabled={ocupado} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
        {itens.map((a) => {
          const Icone = a.icone;
          return (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => {
                setAberto(false);
                a.onClick?.();
              }}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-muted", a.perigo && "text-california-red")}
            >
              <Icone className={cn("h-4 w-4 shrink-0", a.dica && "mt-0.5 self-start", a.perigo ? "text-california-red" : "text-muted-foreground")} />
              {a.dica ? (
                <span className="min-w-0">
                  <span className="block">{a.rotulo}</span>
                  <span className="block text-[11px] font-normal leading-snug text-muted-foreground">{a.dica}</span>
                </span>
              ) : (
                a.rotulo
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
