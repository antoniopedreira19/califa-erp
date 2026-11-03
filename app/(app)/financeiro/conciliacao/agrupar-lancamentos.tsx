"use client";

/**
 * "Agrupar lançamentos" (decisão 234): o pagamento que o banco fez em partes
 * diferentes das baixas do sistema (ex.: baixas de R$ 3.000 + R$ 2.000 × dois
 * PIX de R$ 2.500). Substitui o "Conciliar em conjunto" (decisão 211, 28/10),
 * que a pessoa achava no ⋯ e montava à mão:
 *  - `acharAgrupamentos`: o sistema acha sozinho — baixas sem linha no banco ×
 *    linhas sem correspondência, mesmo sentido, até 7 dias, soma exata, 1 a 4
 *    itens de cada lado e ao menos 3 no total, a mesma contraparte (1ª palavra
 *    significativa do fornecedor × do histórico) e, se um item cabe em mais de
 *    uma combinação, nada.
 *  - `ResumoDoAgrupamento`: a linha à vista ("Som Norte · No sistema: …").
 *  - `AgruparLancamentosDialog`: o pop-up, com a mesma action
 *    (`conciliarEmConjunto(linhaIds, lancamentoIds)`) e as mesmas regras
 *    (pendentes, mesmo sentido, ±7 dias, cada linha com ao menos uma baixa,
 *    totais iguais no centavo).
 */

import * as React from "react";
import { CheckCheck, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { normalizar } from "@/lib/conciliacao/ofx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dataBR } from "@/components/financeiro/planilha-de-titulos/planilha";

const moeda = formatBRL;
const cents = (v: number) => Math.round(Math.abs(v) * 100);
const DIAS_DO_AGRUPAMENTO = 7;
const DIA = 86_400_000;

/** A baixa sem linha no banco (o `LancamentoSemLinha` que importa aqui). */
export interface BaixaDoAgrupamento {
  id: string;
  ids: string[];
  data: string;
  valor: number;
  descricao: string;
  fornecedor: string | null;
}

/** A linha do banco pendente. */
export interface LinhaDoAgrupamento {
  id: string;
  data: string;
  valor: number;
  historico: string;
}

export interface AgrupamentoAchado {
  id: string;
  nome: string;
  baixas: BaixaDoAgrupamento[];
  linhas: LinhaDoAgrupamento[];
  total: number;
}

/** O que a aba abre no pop-up: os itens já marcados e a referência (de onde
 *  veio: a data, o sentido e a contraparte). */
export interface SelecaoDoAgrupamento {
  baixas: string[];
  linhas: string[];
  ref: { data: string; valor: number; nome: string | null };
}


// ---------------------------------------------------------------------------
// A contraparte: a 1ª palavra significativa
// ---------------------------------------------------------------------------

const GENERICAS = new Set(
  "PIX ENVIADO ENVIADA RECEBIDO RECEBIDA TED DOC PAGAMENTO PAGTO PAG DE DA DO DOS DAS TITULO BOLETO TRANSF TRANSFERENCIA CHAVE ALEATORIA DEBITO CREDITO AUTOMATICO SISPAG TARIFA LTDA EPP EIRELI CIA COMPRA CARTAO CODE PARA INTERNET BANKING ELETRONICO ENVIO REMESSA DEVOLUCAO OPERACAO".split(
    " ",
  ),
);

function chaveDaParte(s: string | null | undefined): string | null {
  for (const tok of normalizar(s).replace(/[^A-Z0-9 ]/g, " ").split(" ")) {
    if (tok.length >= 3 && !/\d/.test(tok) && !GENERICAS.has(tok)) return tok;
  }
  return null;
}

/** O nome para a tela: o fornecedor sem "Ltda", "ME"… */
const nomeCurto = (s: string | null) => (s ?? "").replace(/\s+(ltda\.?|me|epp|s\/?a|eireli)\.?$/i, "").trim();

// ---------------------------------------------------------------------------
// Achar os conjuntos
// ---------------------------------------------------------------------------

function combinacoes<T>(xs: T[], max: number): T[][] {
  const out: T[][] = [];
  const ir = (i: number, atual: T[]) => {
    if (atual.length) out.push(atual);
    if (atual.length === max) return;
    for (let k = i; k < xs.length; k++) ir(k + 1, [...atual, xs[k]]);
  };
  ir(0, []);
  return out;
}

const dentroDaJanela = (datas: string[]) => {
  const ts = datas.map((d) => Date.parse(d));
  return Math.max(...ts) - Math.min(...ts) <= DIAS_DO_AGRUPAMENTO * DIA;
};

/** Todas as combinações válidas (soma exata, janela, tamanhos, cada linha com
 *  ao menos uma baixa), entre as baixas e as linhas dadas. */
function validas(baixas: BaixaDoAgrupamento[], linhas: LinhaDoAgrupamento[]): Array<{ baixas: BaixaDoAgrupamento[]; linhas: LinhaDoAgrupamento[] }> {
  const bs = combinacoes(baixas.slice(0, 10), 4);
  const porSoma = new Map<number, LinhaDoAgrupamento[][]>();
  for (const c of combinacoes(linhas.slice(0, 10), 4)) {
    const s = c.reduce((a, l) => a + cents(l.valor), 0);
    porSoma.set(s, [...(porSoma.get(s) ?? []), c]);
  }
  const out: Array<{ baixas: BaixaDoAgrupamento[]; linhas: LinhaDoAgrupamento[] }> = [];
  for (const b of bs) {
    const s = b.reduce((a, l) => a + cents(l.valor), 0);
    for (const l of porSoma.get(s) ?? []) {
      if (b.length + l.length < 3 || b.length < l.length) continue;
      if (!dentroDaJanela([...b.map((x) => x.data), ...l.map((x) => x.data)])) continue;
      out.push({ baixas: b, linhas: l });
    }
  }
  return out;
}

/** Os conjuntos que o sistema acha sozinho (sem ambiguidade). */
export function acharAgrupamentos(baixas: BaixaDoAgrupamento[], linhas: LinhaDoAgrupamento[]): AgrupamentoAchado[] {
  const grupos = new Map<string, { baixas: BaixaDoAgrupamento[]; linhas: LinhaDoAgrupamento[] }>();
  for (const b of baixas) {
    const k = chaveDaParte(b.fornecedor);
    if (!k) continue;
    const g = `${Math.sign(b.valor)}|${k}`;
    grupos.set(g, { baixas: [...(grupos.get(g)?.baixas ?? []), b], linhas: grupos.get(g)?.linhas ?? [] });
  }
  for (const l of linhas) {
    const k = chaveDaParte(l.historico);
    const g = `${Math.sign(l.valor)}|${k}`;
    const x = grupos.get(g);
    if (k && x) x.linhas.push(l);
  }
  const achados: AgrupamentoAchado[] = [];
  for (const g of grupos.values()) {
    if (!g.linhas.length) continue;
    const vs = validas(g.baixas, g.linhas);
    // O item que cabe em mais de uma combinação fica para o manual.
    const usos = new Map<string, number>();
    for (const v of vs) for (const id of [...v.baixas.map((b) => "b" + b.id), ...v.linhas.map((l) => "l" + l.id)]) usos.set(id, (usos.get(id) ?? 0) + 1);
    for (const v of vs) {
      const ids = [...v.baixas.map((b) => "b" + b.id), ...v.linhas.map((l) => "l" + l.id)];
      if (ids.some((id) => (usos.get(id) ?? 0) > 1)) continue;
      achados.push({
        id: ids.join(","),
        nome: nomeCurto(v.baixas[0].fornecedor) || v.baixas[0].descricao,
        baixas: [...v.baixas].sort((a, b) => a.data.localeCompare(b.data)),
        linhas: [...v.linhas].sort((a, b) => a.data.localeCompare(b.data)),
        total: Math.round(v.baixas.reduce((a, b) => a + b.valor, 0) * 100) / 100,
      });
    }
  }
  return achados;
}

/** A melhor combinação que contém o item de onde o pop-up abriu: a única da
 *  mesma contraparte; sem ela, a única entre todos. */
function melhorCombinacao(
  baixas: BaixaDoAgrupamento[],
  linhas: LinhaDoAgrupamento[],
  foco: { baixa?: string; linha?: string },
  chave: string | null,
): { baixas: string[]; linhas: string[] } | null {
  const contem = (v: { baixas: BaixaDoAgrupamento[]; linhas: LinhaDoAgrupamento[] }) =>
    (foco.baixa ? v.baixas.some((b) => b.id === foco.baixa) : true) && (foco.linha ? v.linhas.some((l) => l.id === foco.linha) : true);
  const tentativas = chave
    ? [
        [baixas.filter((b) => chaveDaParte(b.fornecedor) === chave), linhas.filter((l) => chaveDaParte(l.historico) === chave)] as const,
        [baixas, linhas] as const,
      ]
    : [[baixas, linhas] as const];
  for (const [bs, ls] of tentativas) {
    const vs = validas([...bs], [...ls]).filter(contem);
    if (vs.length === 1) return { baixas: vs[0].baixas.map((b) => b.id), linhas: vs[0].linhas.map((l) => l.id) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// A linha à vista
// ---------------------------------------------------------------------------

/** 3.000 / 2.500,50: sem centavos quando é redondo. */
function curto(v: number): string {
  const a = Math.abs(v);
  return a.toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(a) ? 0 : 2, maximumFractionDigits: 2 });
}

function nomeDasLinhas(ls: LinhaDoAgrupamento[]): string {
  const n = ls.length;
  const todas = (re: RegExp) => ls.every((l) => re.test(l.historico.toUpperCase()));
  if (todas(/\bPIX\b/)) return `${n} PIX`;
  if (todas(/\bTED\b/)) return `${n} TED`;
  return n === 1 ? "1 linha" : `${n} linhas`;
}


export function ResumoDoAgrupamento({ c, className }: { c: AgrupamentoAchado; className?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs", className)}>
      <strong className="font-semibold">{c.nome}</strong>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">No sistema:</span>
      <span>
        {c.baixas.length === 1 ? "1 baixa" : `${c.baixas.length} baixas`} ({c.baixas.map((b) => curto(b.valor)).join(" + ")})
      </span>
      <span className="font-semibold text-muted-foreground">=</span>
      <span className="text-muted-foreground">No banco:</span>
      <span>
        {nomeDasLinhas(c.linhas)} ({c.linhas.map((l) => curto(l.valor)).join(" + ")})
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-700">
        R$ {curto(c.total)}
        <CheckCheck className="h-3.5 w-3.5" />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// O pop-up
// ---------------------------------------------------------------------------

function Caixa({ marcado }: { marcado: boolean }) {
  return (
    <span
      role="checkbox"
      aria-checked={marcado}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        marcado ? "border-california-red bg-california-red text-white" : "border-gray-300 bg-white",
      )}
    >
      {marcado && <CheckCheck className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

const BOTAO = "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function AgruparLancamentosDialog({
  selecao,
  linhas,
  baixas,
  pending,
  erro,
  onFechar,
  onConfirmar,
}: {
  selecao: SelecaoDoAgrupamento;
  /** As linhas do banco ainda pendentes da conta. */
  linhas: ReadonlyArray<LinhaDoAgrupamento>;
  /** As baixas que o banco não mostra. */
  baixas: BaixaDoAgrupamento[];
  pending: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: (linhaIds: string[], lancamentoIds: string[]) => void;
}) {
  const ref = selecao.ref;
  const chave = chaveDaParte(ref.nome);
  const perto = (data: string) => Math.abs(Date.parse(data) - Date.parse(ref.data)) <= DIAS_DO_AGRUPAMENTO * DIA;
  const mesmoSinal = (v: number) => Math.sign(v) === Math.sign(ref.valor);
  const mesmaParteB = (b: BaixaDoAgrupamento) => !!chave && chaveDaParte(b.fornecedor) === chave;
  const mesmaParteL = (l: LinhaDoAgrupamento) => !!chave && chaveDaParte(l.historico) === chave;
  const ordem = <T extends { data: string; valor: number }>(mesma: (x: T) => boolean) => (a: T, b: T) =>
    Number(mesma(b)) - Number(mesma(a)) || a.data.localeCompare(b.data) || Math.abs(b.valor) - Math.abs(a.valor);
  const candBaixas = React.useMemo(() => baixas.filter((b) => perto(b.data) && mesmoSinal(b.valor)).sort(ordem(mesmaParteB)), [baixas]); // eslint-disable-line react-hooks/exhaustive-deps
  const candLinhas = React.useMemo(() => linhas.filter((l) => perto(l.data) && mesmoSinal(l.valor)).sort(ordem(mesmaParteL)), [linhas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Já abre com a melhor combinação marcada, quando existe.
  const [marcadas, setMarcadas] = React.useState<{ baixas: string[]; linhas: string[] }>(() => {
    const n = selecao.baixas.length + selecao.linhas.length;
    if (n === 1) {
      const m = melhorCombinacao(candBaixas, [...candLinhas], { baixa: selecao.baixas[0], linha: selecao.linhas[0] }, chave);
      if (m) return m;
    }
    return { baixas: selecao.baixas, linhas: selecao.linhas };
  });
  const alternar = (lado: "baixas" | "linhas", id: string) =>
    setMarcadas((m) => ({ ...m, [lado]: m[lado].includes(id) ? m[lado].filter((x) => x !== id) : [...m[lado], id] }));

  const bs = candBaixas.filter((b) => marcadas.baixas.includes(b.id));
  const ls = candLinhas.filter((l) => marcadas.linhas.includes(l.id));
  const totS = bs.reduce((a, b) => a + cents(b.valor), 0) / 100;
  const totB = ls.reduce((a, l) => a + cents(l.valor), 0) / 100;
  const iguais = bs.length > 0 && ls.length > 0 && Math.round(totS * 100) === Math.round(totB * 100);
  const regra = ls.length > 0 && bs.length < ls.length;
  const pode = iguais && !regra;

  let indicador: React.ReactNode;
  if (!bs.length && !ls.length) indicador = <span className="text-muted-foreground">Marque dos dois lados</span>;
  else if (!ls.length) indicador = <span className="text-amber-700">R$ {curto(totS)} no sistema · marque as linhas do banco que pagaram</span>;
  else if (!bs.length) indicador = <span className="text-amber-700">R$ {curto(totB)} no banco · marque as baixas do sistema</span>;
  else if (iguais && regra)
    indicador = (
      <span className="text-amber-700">
        Cada linha do banco precisa de ao menos uma baixa: {ls.length} linhas, {bs.length} {bs.length === 1 ? "baixa" : "baixas"}
      </span>
    );
  else if (iguais)
    indicador = (
      <span className="inline-flex items-center gap-2 text-emerald-700">
        R$ {curto(totS)} = R$ {curto(totB)}
        <CheckCheck className="h-5 w-5" />
      </span>
    );
  else if (totS < totB) indicador = <span className="text-amber-700">R$ {curto(totS)} de {curto(totB)} · faltam R$ {curto(totB - totS)} no sistema</span>;
  else indicador = <span className="text-amber-700">R$ {curto(totB)} de {curto(totS)} · faltam R$ {curto(totS - totB)} no banco</span>;

  const vazio = (t: string) => <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t}</p>;
  const Destaque = () => <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-700">mesma contraparte</span>;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[960px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-california-red" />
            Agrupar lançamentos
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">Marque as baixas e as linhas do banco do mesmo pagamento. Os dois totais precisam ser iguais.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ["No sistema", "baixas", candBaixas, totS, bs.length],
              ["No banco", "linhas", candLinhas, totB, ls.length],
            ] as const
          ).map(([titulo, lado, cands, tot, n]) => (
            <div key={lado} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border">
              <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {titulo} <span className="font-normal normal-case tracking-normal">· {lado === "baixas" ? "baixas sem linha no banco" : "linhas pendentes"}</span>
              </p>
              <div className="max-h-[40vh] flex-1 divide-y divide-border overflow-y-auto">
                {cands.length === 0
                  ? vazio(lado === "baixas" ? "Nenhuma baixa sem linha perto desta data." : "Nenhuma linha do banco pendente perto desta data.")
                  : lado === "baixas"
                    ? (cands as BaixaDoAgrupamento[]).map((b) => {
                        const m = marcadas.baixas.includes(b.id);
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => alternar("baixas", b.id)}
                            className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50", m && "bg-california-red/[0.04]", mesmaParteB(b) && "border-l-2 border-l-sky-400")}
                          >
                            <Caixa marcado={m} />
                            <span className="w-[42px] shrink-0 font-mono text-[11px] text-muted-foreground">{dataBR(b.data).slice(0, 5)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold" title={b.descricao}>
                                {b.descricao}
                              </span>
                              <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                                {b.fornecedor ?? "—"}
                                {mesmaParteB(b) && <Destaque />}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-xs">{moeda(Math.abs(b.valor))}</span>
                          </button>
                        );
                      })
                    : (cands as LinhaDoAgrupamento[]).map((l) => {
                        const m = marcadas.linhas.includes(l.id);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => alternar("linhas", l.id)}
                            className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50", m && "bg-california-red/[0.04]", mesmaParteL(l) && "border-l-2 border-l-sky-400")}
                          >
                            <Caixa marcado={m} />
                            <span className="w-[42px] shrink-0 font-mono text-[11px] text-muted-foreground">{dataBR(l.data).slice(0, 5)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-[11px]" title={l.historico}>
                                {l.historico.replace(/\s{2,}.*$/, "")}
                              </span>
                              {mesmaParteL(l) && <Destaque />}
                            </span>
                            <span className="shrink-0 font-mono text-xs">{moeda(Math.abs(l.valor))}</span>
                          </button>
                        );
                      })}
              </div>
              <p className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Total marcado{n ? ` (${n})` : ""}</span>
                <strong className="font-mono">{moeda(tot)}</strong>
              </p>
            </div>
          ))}
        </div>
        <div className={cn("rounded-lg border px-4 py-3 text-center text-lg font-semibold", pode ? "border-emerald-200 bg-emerald-50" : bs.length || ls.length ? "border-amber-200 bg-amber-50" : "border-border bg-muted/30")}>
          {indicador}
        </div>
        <DialogFooter className="items-center gap-3">
          {erro && <p className="mr-auto text-xs font-semibold text-california-red">{erro}</p>}
          <button type="button" onClick={onFechar} className={cn(BOTAO, "border border-border bg-white text-foreground hover:bg-muted/50")}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!pode || pending}
            onClick={() => onConfirmar(ls.map((l) => l.id), bs.flatMap((b) => b.ids))}
            className={cn(BOTAO, "bg-emerald-600 text-white hover:bg-emerald-700")}
          >
            <CheckCheck className="h-4 w-4" />
            {pending ? "Conciliando…" : "Conciliar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
