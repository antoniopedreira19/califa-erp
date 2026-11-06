"use client";

/**
 * As linhas da fila da Conciliação automática (decisões 234 e 243): a linha
 * do banco, as linhas iguais, a baixa sem linha no banco e o agrupamento
 * achado. Todas nas mesmas colunas — Data | Descrição no banco | Valor |
 * Situação | No sistema · Descrição | Fornecedor | Job | Tipo | TRI | Reg |
 * Ação — e nenhuma expande: o motivo, o centro de custo, o texto inteiro e o
 * dono do CNPJ ficam nas dicas.
 */

import * as React from "react";
import { CheckCheck, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dataBR } from "@/components/financeiro/planilha-de-titulos/planilha";
import { rateioPonderado, siglaDaRegional, textoDaRegional, trimestreDe, type ParteDoRateio } from "@/lib/financeiro/planilha-de-titulos";
import { pixDeEmpresaDeFora } from "@/lib/financeiro/mutuo";
import type { ResultadoDaLinha } from "./motor-da-conta";
import { textoDoCentro } from "./banco-tabela";
import {
  acoesDoAgrupamento,
  acoesDaBaixaSemLinha,
  acoesDaLinha,
  acoesDaLinhaDoGrupo,
  BotaoPrincipal,
  MenuMais,
  moeda,
  PilulaDoTipo,
  resumoDoSistema,
  TIPOS,
  type Item,
  type PropsDaFila,
  type Tipo,
} from "./fila-da-conta";

// ---------------------------------------------------------------------------
// A Situação: o motivo da linha (a divisão já diz o que fazer)
// ---------------------------------------------------------------------------

/** O motivo de uma linha, das contas do próprio motor. */
function motivoDaLinha(r: ResultadoDaLinha, tipo: Tipo): string | undefined {
  if (r.resolvido) return undefined;
  if (tipo === "pronto") return r.estado === "combinacao" ? "Soma do fornecedor" : "Título exato";
  if (tipo === "varios") return r.estado === "soma" ? "Remessa" : "Vários títulos";
  if (tipo !== "conferir") return undefined;
  if (r.estado === "diferenca") {
    if (r.retencaoSugerida) return "Retenção na fonte";
    return (r.diferenca ?? 0) !== 0 && Math.abs(r.mov.valor) > (r.titulo?.liquido ?? 0) ? "Juros e multa" : "Diferença de valor";
  }
  if (r.titulo?.lado === "imposto") return "Guia de imposto";
  if (!r.titulo?.centro) return "Sem centro de custo";
  return "Confirmar o título";
}

/** O rótulo da Situação de uma linha do banco. */
function situacaoDaLinha(r: ResultadoDaLinha, tipo: Tipo): string {
  if (r.resolvido && tipo !== "manual") return r.resolvido.estado === "ignorado" ? "Ignorado" : r.resolvido.sozinho ? "Conciliado sozinho" : "Conciliado";
  return motivoDaLinha(r, tipo) ?? TIPOS[tipo].rotulo;
}

// ---------------------------------------------------------------------------
// Fornecedor, Job, Tipo, TRI e Reg (decisão 243)
// ---------------------------------------------------------------------------

interface Quem {
  quem: string | null;
  job: { codigo: string; nome: string } | null;
  jobs: number;
  rateio: ParteDoRateio[] | null;
  /** A regional já em texto (a da baixa, da regra ou da planilha; "TD" é todas). */
  reg?: string | null;
  /** O código do tipo do plano de contas ("04"), ou já a sigla da planilha. */
  tipo?: string | null;
  /** O trimestre quando não é o da data (o do tipo, no mútuo). */
  tri?: string | null;
}
const VAZIO: Quem = { quem: null, job: null, jobs: 0, rateio: null };

/** As siglas do Tipo como a planilha do financeiro escreve (o grupo da DRE),
 *  pelo código do tipo do plano de contas. Conferidas na carga do histórico
 *  (`historico_movimentos`, 2021–2026). O 16 (câmbio, decisão 229) não tem
 *  sigla na planilha e aparece pelo código. */
const SIGLA_DO_TIPO: Record<string, string> = {
  "01": "REC", "02": "CO", "03": "CT", "04": "CF", "05": "DP", "06": "DM", "07": "DA", "08": "DC",
  "09": "DT", "10": "RF", "11": "DJ", "12": "EMP", "13": "IMOB", "14": "PL", "15": "DL",
};
const NOME_DO_TIPO: Record<string, string> = {
  "01": "Receita", "02": "Custo Operacional", "03": "Custo Tributário", "04": "Custo Fixo", "05": "Despesa com Pessoal",
  "06": "Despesa de Marketing", "07": "Despesa Administrativa", "08": "Despesa Comercial", "09": "Despesa Trabalhista",
  "10": "Receita Financeira", "11": "Despesa com Juros", "12": "Empréstimos", "13": "Imobilizado", "14": "Bonificação",
  "15": "Distribuição de Lucro", "16": "Despesas de câmbio",
};
const ehCodigo = (t: string) => /^\d{2}$/.test(t);
const siglaDoTipo = (t: string) => (ehCodigo(t) ? SIGLA_DO_TIPO[t] ?? t : t);
/** O código do tipo no começo do rótulo do centro ("04 · Custo Fixo · …"). */
const tipoDoRotulo = (r: string | null | undefined) => r?.match(/^(\d{2})\b/)?.[1] ?? null;
const unicos = <T,>(xs: T[]) => [...new Set(xs)];

/** A baixa como o Extrato a mostra (`extratoPorLancamento`, a mesma leitura). */
function daBaixa(id: string | undefined, banco: PropsDaFila["banco"], quem: string | null = null): Quem {
  const e = id ? banco.extratoPorLancamento[id] : undefined;
  return e ? { quem: e.fornecedor ?? quem, job: e.job, jobs: e.jobs, rateio: null, reg: e.reg, tipo: e.tipo, tri: e.tri } : { ...VAZIO, quem };
}

/** De quem é e onde cai: dos títulos que o motor achou, da baixa já
 *  lançada, da regra, do mútuo ou da planilha. */
function quemDaLinha(r: ResultadoDaLinha, ctx: PropsDaFila["contexto"], banco: PropsDaFila["banco"]): Quem {
  if (r.resolvido) {
    // A baixa ligada à linha (a principal, não os juros).
    const ligados = r.mov.linha.ligados ?? [];
    const principal = ligados.find((x) => x.origem !== "juros_baixa") ?? ligados[0];
    // A conciliada pela planilha não tem lançamento: vale a linha da planilha.
    if (!principal && r.mov.linha.historicos?.length) return quemDaPlanilha(r.mov.linha.historicos);
    return daBaixa(principal?.id, banco);
  }
  if (r.regra) {
    const id = r.regra.regionalId;
    const nome = id ? banco.regionais.find((g) => g.id === id)?.nome ?? null : "TD";
    return { ...VAZIO, reg: nome, tipo: tipoDoRotulo(r.regra.centro) };
  }
  if (r.mutuo) return { ...VAZIO, quem: r.mutuo.parte.nome, tipo: pixDeEmpresaDeFora(r.mutuo) ? null : "MÚTUO INT" };
  const ts = r.titulo ? [r.titulo] : r.titulos?.length ? r.titulos : r.lote?.titulos ?? [];
  if (ts.length) return quemDosTitulos(ts, ctx);
  if (r.lancamento) {
    const l = ctx.lancamentos.get(r.lancamento.id);
    return daBaixa(l?.id, banco, l?.fornecedor ?? null);
  }
  if (r.historicos?.length) return quemDaPlanilha(r.historicos);
  return VAZIO;
}

/** As linhas da planilha (o histórico até o 3T ou a previsão): fornecedor,
 *  job, regional e o grupo da DRE como a própria planilha escreve. */
function quemDaPlanilha(hs: Array<{ job: string | null; fornecedor?: string | null; regional?: string | null; grupo?: string | null }>): Quem {
  const qs = unicos(hs.map((h) => h.fornecedor).filter(Boolean) as string[]);
  const js = unicos(hs.map((h) => h.job).filter(Boolean) as string[]);
  const rs = unicos(hs.map((h) => h.regional).filter(Boolean) as string[]);
  return {
    quem: qs.length === 1 ? qs[0] : qs.length ? `${qs.length} fornecedores` : null,
    job: js.length === 1 ? { codigo: js[0], nome: js[0] } : null,
    jobs: js.length,
    rateio: null,
    reg: rs.length === 1 ? rs[0] : rs.length > 1 ? "TD" : null,
    tipo: unicos(hs.map((h) => h.grupo).filter(Boolean) as string[]).join(" · ") || null,
  };
}

function quemDosTitulos(ts: Array<{ id: string; contraparte: string; liquido: number }>, ctx: PropsDaFila["contexto"]): Quem {
  const ls = ts.map((t) => ({ t, l: ctx.linhaPorChave.get(t.id) }));
  const qs = unicos(ls.map(({ t, l }) => l?.contraparte ?? t.contraparte));
  const js = unicos(ls.map(({ l }) => l?.job?.codigo).filter(Boolean) as string[]);
  const job = js.length === 1 ? ls.find(({ l }) => l?.job?.codigo === js[0])?.l?.job ?? null : null;
  const comRateio = ls.filter(({ l }) => l && l.rateio.length);
  const rateio = comRateio.length ? rateioPonderado(comRateio.map(({ t, l }) => ({ valor: Math.abs(t.liquido), rateio: l!.rateio }))) : null;
  const tipos = unicos(ls.map(({ l }) => (l?.centro.tipo === "plano" ? tipoDoRotulo(l.centro.rotulo) : null)).filter(Boolean) as string[]);
  return {
    quem: qs.length === 1 ? qs[0] : `${qs.length} fornecedores`,
    job,
    jobs: js.length,
    rateio,
    tipo: tipos.length === 1 ? tipos[0] : tipos.length > 1 ? "vários" : null,
  };
}

const Traco = () => <span className="text-muted-foreground/60">—</span>;

function TextoDoJob({ q }: { q: Quem }) {
  // O código, e o nome que o financeiro deu ao passar o mouse.
  if (q.job)
    return (
      <Dica
        conteudo={(q.job.nome.startsWith(q.job.codigo + " ") ? q.job.nome.slice(q.job.codigo.length + 1) : q.job.nome) || null}
        className="block min-w-0 max-w-full truncate font-mono text-[11px]"
      >
        {q.job.codigo}
      </Dica>
    );
  if (q.jobs > 1) return <span className="text-[11px] text-muted-foreground">{q.jobs} jobs</span>;
  return <Traco />;
}

function TextoDoTipo({ q }: { q: Quem }) {
  if (!q.tipo) return <Traco />;
  if (q.tipo === "vários") return <span className="text-[11px] text-muted-foreground">vários</span>;
  const dica = ehCodigo(q.tipo)
    ? `${q.tipo} · ${NOME_DO_TIPO[q.tipo] ?? ""}`
    : q.tipo === "MÚTUO INT"
      ? "Mútuo entre empresas do grupo (tipo 12), fora da DRE"
      : q.tipo === "ESTORNO"
        ? "Estorno, fora da DRE"
        : `${q.tipo} · como na planilha`;
  return (
    <Dica conteudo={dica} className="block truncate font-mono text-[11px]">
      {siglaDoTipo(q.tipo)}
    </Dica>
  );
}

function TextoDaReg({ q }: { q: Quem }) {
  if (q.reg)
    return (
      <Dica conteudo={q.reg === "TD" ? "Todas as regionais" : q.reg} className="font-mono text-[11px]">
        {q.reg === "TD" ? "TD" : siglaDaRegional(q.reg)}
      </Dica>
    );
  if (!q.rateio) return <Traco />;
  const { texto, dica, rateado } = textoDaRegional(q.rateio);
  if (texto === "—") return <Traco />;
  return (
    <Dica conteudo={dica} className={cn("font-mono text-[11px]", rateado && "underline decoration-dotted underline-offset-2")}>
      {texto}
    </Dica>
  );
}

/** Fornecedor | Job | Tipo | TRI | Reg. O TRI é o da data (como no Extrato),
 *  ou o do tipo no mútuo; sem título escolhido, fica vazio. */
function CelulasExtras({ q, data }: { q: Quem; data?: string }) {
  return (
    <>
      <td className="px-3 py-2 text-xs">
        {q.quem ? (
          <Dica conteudo={q.quem} className="block w-full truncate">
            {q.quem}
          </Dica>
        ) : (
          <Traco />
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        <TextoDoJob q={q} />
      </td>
      <td className="px-3 py-2 text-xs">
        <TextoDoTipo q={q} />
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="font-mono text-[11px]">{q.tri ?? (data ? trimestreDe(data) : "—")}</span>
      </td>
      <td className="px-3 py-2 text-xs">
        <TextoDaReg q={q} />
      </td>
    </>
  );
}

/** "No sistema" sem o fornecedor, que tem coluna própria. */
function semQuem(texto: string, q: Quem): string {
  return q.quem && texto.endsWith(" · " + q.quem) ? texto.slice(0, -(" · " + q.quem).length) : texto;
}

// ---------------------------------------------------------------------------
// O texto do banco e o dono do CNPJ
// ---------------------------------------------------------------------------

const docsDoTexto = (t: string) => [...t.matchAll(/(?<!\d)(\d{14}|\d{11})(?!\d)/g)].map((m) => m[1]);
const mascara = (d: string) =>
  d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;

/** O texto do banco inteiro na dica e, se tiver CNPJ ou CPF, de quem é pelo
 *  cadastro (o banco quase nunca escreve o nome). */
function TextoDoBanco({ historico, p }: { historico: string; p: PropsDaFila }) {
  const achados = docsDoTexto(historico).map((d) => ({ d, q: p.banco.quemPorDocumento[d] }));
  const conhecido = achados.some((a) => a.q);
  return (
    <Dica
      conteudo={
        <>
          {historico}
          {achados.map(({ d, q }) => (
            <span key={d} className="mt-1 block opacity-90">
              {d.length === 14 ? "CNPJ" : "CPF"} {mascara(d)}: {q ? `${q.nome} · ${q.papel}` : "não está no cadastro"}
            </span>
          ))}
        </>
      }
      className={cn("block w-full truncate", conhecido && "underline decoration-dotted underline-offset-2")}
    >
      {historico}
    </Dica>
  );
}

// ---------------------------------------------------------------------------
// Os filtros por coluna (decisão 165)
// ---------------------------------------------------------------------------

/** O que cada coluna mostra de um item da fila, em texto, para o filtro. */
export interface CelulasDoItem {
  data: string;
  banco: string;
  valor: number;
  situacao: string;
  sistema: string;
  quem: string | null;
  job: string | null;
  tipo: string | null;
  tri: string;
  reg: string | null;
}

function colunasDoQuem(q: Quem, data = ""): Pick<CelulasDoItem, "quem" | "job" | "tipo" | "tri" | "reg"> {
  const reg = q.reg ? (q.reg === "TD" ? "TD" : siglaDaRegional(q.reg)) : q.rateio ? textoDaRegional(q.rateio).texto : "—";
  return {
    quem: q.quem,
    job: q.job?.codigo ?? (q.jobs > 1 ? `${q.jobs} jobs` : null),
    tipo: q.tipo ? siglaDoTipo(q.tipo) : null,
    tri: q.tri ?? (data ? trimestreDe(data) : "—"),
    reg: reg === "—" ? null : reg,
  };
}

export function celulasDoItem(i: Item, p: Pick<PropsDaFila, "contexto" | "banco">): CelulasDoItem {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (i.k === "linha") {
    const q = quemDaLinha(i.r, p.contexto, p.banco);
    return {
      data: i.r.mov.data,
      banco: i.r.mov.historico,
      valor: i.r.mov.valor,
      situacao: situacaoDaLinha(i.r, i.tipo),
      sistema: semQuem(resumoDoSistema(i.r, p.contexto), q),
      ...colunasDoQuem(q, i.r.mov.data),
    };
  }
  if (i.k === "grupo")
    // As linhas iguais começam sem título escolhido: as colunas do sistema
    // ficam vazias até o financeiro escolher.
    return {
      data: i.data,
      banco: i.g.linhas[0]?.mov.historico ?? "",
      valor: r2(i.g.linhas.reduce((s, r) => s + r.mov.valor, 0)),
      situacao: i.g.linhas.length === 1 ? "Mesmo valor" : "Linha igual",
      sistema: `${i.g.linhas.length} linhas iguais · ${i.g.titulos.length} títulos`,
      ...colunasDoQuem(VAZIO),
    };
  if (i.k === "semLinha")
    return {
      data: i.data,
      banco: "sem linha no banco",
      valor: i.l.valor,
      situacao: "Sem linha no banco",
      sistema: i.l.descricao,
      ...colunasDoQuem(daBaixa(i.l.id, p.banco, i.l.fornecedor), i.data),
    };
  return {
    data: i.data,
    banco: `${i.rs.length} linhas · ${i.rs.map((r) => moeda(Math.abs(r.mov.valor))).join(" + ")}`,
    valor: r2(i.rs.reduce((s, r) => s + r.mov.valor, 0)),
    situacao: "Agrupar",
    sistema: `${i.ls.length} baixas · ${i.ls.map((l) => moeda(Math.abs(l.valor))).join(" + ")}`,
    ...colunasDoQuem(daBaixa(i.ls[0]?.id, p.banco, i.ls[0]?.fornecedor ?? null), i.data),
  };
}

// ---------------------------------------------------------------------------
// As colunas e as células comuns
// ---------------------------------------------------------------------------

const LARGURAS = [96, 200, 130, 145, 300, 170, 120, 58, 50, 56, 176];
/** A largura mínima da tabela: a soma das colunas. A sobra da tela se divide
 *  entre elas na mesma proporção. */
export const LARGURA_DA_FILA = LARGURAS.reduce((s, w) => s + w, 0);

/** As colunas da fila: o MESMO `colgroup` em todas as divisões. */
export function Colunas() {
  return (
    <colgroup>
      {LARGURAS.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

function Valor({ v }: { v: number }) {
  return (
    <td className={cn("whitespace-nowrap px-3 py-2 text-right font-mono text-xs", v < 0 ? "text-california-red" : "text-emerald-700")}>
      {v < 0 ? "− " : "+ "}
      {moeda(Math.abs(v))}
    </td>
  );
}

function CelulaDeAcao({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-2">
      <span className="flex items-center justify-end gap-1">{children}</span>
    </td>
  );
}

/** A dica da Situação: o porquê e o centro de custo. */
function PorQue({ r, p }: { r: ResultadoDaLinha; p: PropsDaFila }) {
  const l = r.titulo ? p.contexto.linhaPorChave.get(r.titulo.id) : undefined;
  const centro = textoDoCentro(l).replace(/^ · /, "");
  return (
    <>
      {r.motivo}
      {centro && <span className="mt-1 block opacity-80">Centro de custo: {centro}</span>}
    </>
  );
}

// ---------------------------------------------------------------------------
// As linhas
// ---------------------------------------------------------------------------

export function LinhaDaFila({ item, p }: { item: Extract<Item, { k: "linha" }>; p: PropsDaFila }) {
  const { r, tipo } = item;
  const d = acoesDaLinha(r, p.acoes, p.contexto);
  const q = quemDaLinha(r, p.contexto, p.banco);
  const sistema = resumoDoSistema(r, p.contexto);
  return (
    <tr className={cn("border-b border-border hover:bg-muted/30", r.resolvido && "text-muted-foreground")}>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(r.mov.data)}</td>
      <td className="px-3 py-2 font-mono text-[11px]">
        <TextoDoBanco historico={r.mov.historico} p={p} />
      </td>
      <Valor v={r.mov.valor} />
      <td className="px-3 py-2">
        <Dica conteudo={!r.resolvido && r.motivo ? <PorQue r={r} p={p} /> : null} className="inline-flex">
          <PilulaDoTipo tipo={tipo === "manual" || !r.resolvido ? tipo : "conciliado"} rotulo={situacaoDaLinha(r, tipo)} />
        </Dica>
      </td>
      <td className="px-3 py-2">
        <Dica conteudo={sistema} className="block w-full truncate text-xs">
          {semQuem(sistema, q)}
        </Dica>
      </td>
      <CelulasExtras q={q} data={item.data} />
      <CelulaDeAcao>
        <BotaoPrincipal d={d} r={r} acoes={p.acoes} className="w-[118px]" />
        <MenuMais itens={d.secundarias} acoes={p.acoes} />
      </CelulaDeAcao>
    </tr>
  );
}

/** As linhas iguais (mesmo dia e valor, com mais títulos que linhas): o
 *  sistema não escolhe sozinho. Cada linha chega vazia, com o seletor do
 *  título na coluna do sistema; escolhido, as colunas se preenchem e a linha
 *  ganha o Conciliar. Escolher um título que está na outra linha troca os
 *  dois (decisão 243). */
export function GrupoNaFila({ item, p }: { item: Extract<Item, { k: "grupo" }>; p: PropsDaFila }) {
  const linhas = React.useMemo(() => [...item.g.linhas].sort((a, b) => a.mov.ordem - b.mov.ordem), [item.g.linhas]) as ResultadoDaLinha[];
  const titulos = item.g.titulos;
  const porId = React.useMemo(() => new Map(titulos.map((t) => [t.id, t])), [titulos]);
  const n = linhas.length;
  const [escolha, setEscolha] = React.useState<Record<string, string>>({});
  const usados = new Set(Object.values(escolha));
  const valor = moeda(Math.abs(linhas[0].mov.valor));
  const dica = `${n} ${n === 1 ? "linha" : "PIX"} de ${valor} no mesmo dia e ${titulos.length} títulos desse valor: o banco não diz quem recebeu cada um. Escolha ${n === 1 ? "o título" : `os ${n} títulos`}.`;
  const escolher = (linhaId: string, id: string) =>
    setEscolha((e) => {
      const outra = Object.keys(e).find((k) => k !== linhaId && e[k] === id);
      return outra ? { ...e, [linhaId]: id, [outra]: e[linhaId] } : { ...e, [linhaId]: id };
    });
  const prontas = linhas.filter((r) => escolha[r.mov.id]);
  const todas =
    prontas.length > 1
      ? [
          {
            rotulo: `Conciliar as ${prontas.length} com os títulos escolhidos`,
            icone: CheckCheck,
            onClick: () => p.acoes.conciliarGrupo(prontas, prontas.map((r) => porId.get(escolha[r.mov.id])!)),
          },
        ]
      : [];
  return (
    <>
      {linhas.map((r, k) => {
        const t = escolha[r.mov.id] ? porId.get(escolha[r.mov.id]) : undefined;
        const d = t ? acoesDaLinhaDoGrupo(r, t, p.acoes, []) : null;
        const q = t ? quemDosTitulos([t], p.contexto) : VAZIO;
        return (
          <tr key={r.mov.id} className="border-b border-border">
            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(r.mov.data)}</td>
            <td className="px-3 py-2 font-mono text-[11px]">
              <TextoDoBanco historico={r.mov.historico} p={p} />
            </td>
            <Valor v={r.mov.valor} />
            <td className="px-3 py-2">
              <Dica conteudo={dica} className="inline-flex">
                <PilulaDoTipo tipo="conferir" rotulo={n === 1 ? "Mesmo valor" : `Linha igual · ${k + 1} de ${n}`} />
              </Dica>
            </td>
            <td className="min-w-0 px-3 py-1.5">
              <Select value={t?.id} onValueChange={(id) => escolher(r.mov.id, id)}>
                <SelectTrigger className={cn("h-7 w-full text-xs", !t && "border-amber-300 bg-amber-50/60 text-amber-900")}>
                  <SelectValue placeholder="Escolha o título…" />
                </SelectTrigger>
                <SelectContent>
                  {titulos.map((x) => {
                    const lx = p.contexto.linhaPorChave.get(x.id);
                    const naOutra = usados.has(x.id) && escolha[r.mov.id] !== x.id;
                    return (
                      <SelectItem key={x.id} value={x.id} className="text-xs">
                        {lx?.descricao ?? x.ref} · {x.contraparte}
                        {naOutra ? " (na outra linha: troca)" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </td>
            <CelulasExtras q={q} data={t ? r.mov.data : undefined} />
            <CelulaDeAcao>
              {d ? (
                <BotaoPrincipal d={d} r={r} acoes={p.acoes} className="w-[118px]" />
              ) : (
                <span className="inline-flex h-7 w-[118px] items-center justify-center text-[11px] text-muted-foreground">escolha o título</span>
              )}
              <MenuMais itens={[...todas, { rotulo: "Procurar outro título", icone: Search, onClick: () => p.acoes.procurar(r), lupa: true }]} acoes={p.acoes} />
            </CelulaDeAcao>
          </tr>
        );
      })}
    </>
  );
}

export function LinhaSemBanco({ item, p }: { item: Extract<Item, { k: "semLinha" }>; p: PropsDaFila }) {
  const l = item.l;
  const d = acoesDaBaixaSemLinha(l, p.acoes);
  return (
    <tr className="border-b border-border bg-red-50/30 hover:bg-red-50/60">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(l.data)}</td>
      <td className="px-3 py-2 text-[11px] italic text-muted-foreground">sem linha no banco</td>
      <Valor v={l.valor} />
      <td className="px-3 py-2">
        <Dica
          conteudo={`Lançamento no Extrato desta conta em ${dataBR(l.data)}. O banco não tem ${l.valor < 0 ? "débito" : "crédito"} de ${moeda(Math.abs(l.valor))} entre as linhas importadas: paga em outra conta, com a data errada ou não paga.`}
          className="inline-flex"
        >
          <PilulaDoTipo tipo="soSistema" />
        </Dica>
      </td>
      <td className="px-3 py-2">
        <Dica conteudo={l.descricao} className="block w-full truncate text-xs">
          {l.descricao}
        </Dica>
      </td>
      <CelulasExtras q={daBaixa(l.id, p.banco, l.fornecedor)} data={l.data} />
      <CelulaDeAcao>
        <BotaoPrincipal d={d} acoes={p.acoes} className="w-[118px]" />
        <MenuMais itens={d.secundarias} acoes={p.acoes} />
      </CelulaDeAcao>
    </tr>
  );
}

/** O agrupamento achado: uma linha nas MESMAS colunas das outras, sem
 *  expandir. O banco à esquerda (as linhas e o total), o sistema à direita
 *  (as baixas, o fornecedor, o job e a regional); cada parte, na dica. */
export function LinhaDoAgrupamento({ item, p }: { item: Extract<Item, { k: "conjunto" }>; p: PropsDaFila }) {
  const d = acoesDoAgrupamento(item.c, p.acoes);
  const total = Math.round(item.rs.reduce((s, r) => s + r.mov.valor, 0) * 100) / 100;
  const parcelas = (vs: number[]) => vs.map((v) => moeda(Math.abs(v))).join(" + ");
  const q = daBaixa(item.ls[0]?.id, p.banco, item.ls[0]?.fornecedor ?? null);
  return (
    <tr className="border-b border-border hover:bg-muted/30">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(item.data)}</td>
      <td className="px-3 py-2 font-mono text-[11px]">
        <Dica
          conteudo={
            <>
              {item.rs.map((r) => (
                <span key={r.mov.id} className="block">
                  {dataBR(r.mov.data).slice(0, 5)} · {r.mov.historico} · {r.mov.valor < 0 ? "− " : "+ "}
                  {moeda(Math.abs(r.mov.valor))}
                </span>
              ))}
            </>
          }
          className="block w-full truncate"
        >
          {item.rs.length} linhas · {parcelas(item.rs.map((r) => r.mov.valor))}
        </Dica>
      </td>
      <Valor v={total} />
      <td className="px-3 py-2">
        <Dica conteudo={TIPOS.dividido.dica} className="inline-flex">
          <PilulaDoTipo tipo="dividido" />
        </Dica>
      </td>
      <td className="px-3 py-2 text-xs">
        <Dica
          conteudo={
            <>
              {item.ls.map((l) => (
                <span key={l.id} className="block">
                  {dataBR(l.data).slice(0, 5)} · {l.descricao} · {moeda(Math.abs(l.valor))}
                </span>
              ))}
            </>
          }
          className="block w-full truncate"
        >
          {item.ls.length} baixas · {parcelas(item.ls.map((l) => l.valor))}
        </Dica>
      </td>
      <CelulasExtras q={q} data={item.data} />
      <CelulaDeAcao>
        <BotaoPrincipal d={d} acoes={p.acoes} className="w-[118px]" />
        <MenuMais itens={d.secundarias} acoes={p.acoes} />
      </CelulaDeAcao>
    </tr>
  );
}
