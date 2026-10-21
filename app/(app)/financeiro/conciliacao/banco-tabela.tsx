"use client";

/**
 * A tabela do extrato do banco na aba Conciliação automática — a versão
 * Alternativa do protótipo (`banco.jsx`: `TabelaDoBanco`, `Situacao`,
 * `NoSistema`, `AcoesDaLinha`, `GrupoNaTabela`, `SemLinhaNoBanco`).
 *
 * Todas as tabelas usam o MESMO `colgroup`, com `table-fixed`: Data ·
 * Histórico do banco · Crédito · Débito · Situação · No sistema · Ação. A
 * célula Ação tem três vagas fixas — a ação principal (136 px), a lupa e o
 * ignorar —, ocupadas ou não, para os botões ficarem numa coluna só.
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, CheckCheck, ChevronDown, CircleSlash, Link2, Plus, Search, Undo2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { GrupoDeIguais, TituloDoMotor } from "@/lib/conciliacao/motor";
import { BotaoDetalhes } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import { dataBR, TOM_DA_ETIQUETA } from "@/components/financeiro/planilha-de-titulos/planilha";
import type { LancamentoSemLinha, RegraDaConta } from "./banco-dados";
import type { Linha } from "./linhas-da-aba";
import type { MovimentoDaLinha, ResultadoDaLinha } from "./motor-da-conta";

const moeda = formatBRL;

// ---------------------------------------------------------------------------
// O contrato com a aba
// ---------------------------------------------------------------------------

/** O que cada botão faz (a aba monta, com as Server Actions). */
export interface AcoesDoBanco {
  /** Uma ação em andamento: os botões ficam esperando. */
  ocupado: boolean;
  ligar: (r: ResultadoDaLinha) => void;
  baixarEConciliar: (r: ResultadoDaLinha) => void;
  conferir: (r: ResultadoDaLinha) => void;
  conciliarCombinacao: (r: ResultadoDaLinha) => void;
  conferirCombinacao: (r: ResultadoDaLinha) => void;
  conciliarLote: (r: ResultadoDaLinha) => void;
  conciliarGrupo: (linhas: ResultadoDaLinha[], escolhidos: TituloDoMotor[]) => void;
  conferirTitulo: (r: ResultadoDaLinha, t: TituloDoMotor) => void;
  conciliarPar: (r: ResultadoDaLinha) => void;
  lancarRegra: (rs: ResultadoDaLinha[]) => void;
  lancarAvulso: (r: ResultadoDaLinha) => void;
  procurar: (r: ResultadoDaLinha) => void;
  ignorar: (r: ResultadoDaLinha) => void;
  desfazer: (r: ResultadoDaLinha) => void;
  corrigirBaixa: (r: ResultadoDaLinha) => void;
  cancelarBaixa: (l: LancamentoSemLinha) => void;
  /** O Extrato, com a baixa em destaque, para trocar a conta ou a data. */
  linkDoLancamento: (l: LancamentoSemLinha) => string;
}

export interface ContextoDasCelulas {
  linhaPorChave: Map<string, Linha>;
  regraPorId: Map<string, RegraDaConta>;
  lancamentos: Map<string, LancamentoSemLinha>;
}

/** O título com centro de custo completo, que a baixa de um clique aceita. */
export const comCentro = (t: TituloDoMotor | null | undefined) => !!t?.centro;

// ---------------------------------------------------------------------------
// As peças da tabela
// ---------------------------------------------------------------------------

/** As colunas de todas as tabelas do banco: o MESMO `colgroup`. */
export function Colunas() {
  return (
    <colgroup>
      <col style={{ width: 96 }} />
      <col style={{ width: 300 }} />
      <col style={{ width: 120 }} />
      <col style={{ width: 120 }} />
      <col style={{ width: 172 }} />
      <col />
      <col style={{ width: 228 }} />
    </colgroup>
  );
}

export type Cor = "emerald" | "amber" | "violet" | "red" | "sky" | "neutral";

const COR_DO_PONTO: Record<Cor, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  red: "bg-california-red",
  sky: "bg-sky-500",
  neutral: "bg-gray-400",
};

/** O botão do cabeçalho de uma seção ("Baixar e conciliar os N"). */
export function BotaoDaSecao({
  children,
  onClick,
  verde,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  verde?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60",
        verde ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-border bg-white text-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

export function Secao({
  titulo,
  ajuda,
  cor,
  quantas,
  aberta,
  onAlternar,
  botao,
  children,
}: {
  titulo: string;
  ajuda: string;
  cor: Cor;
  quantas: number;
  aberta: boolean;
  onAlternar: () => void;
  botao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-[#f3f2ee] px-4 py-2.5">
        <button type="button" onClick={onAlternar} aria-expanded={aberta} className="inline-flex items-center gap-2 text-left">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !aberta && "-rotate-90")} />
          <span className={cn("h-2 w-2 rounded-full", COR_DO_PONTO[cor])} />
          <span className="text-sm font-semibold">{titulo}</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{quantas}</span>
        </button>
        <span className="min-w-[200px] flex-1 text-xs text-muted-foreground">{ajuda}</span>
        {botao}
      </header>
      {aberta && children}
    </section>
  );
}

export function TabelaDoBanco({
  linhas,
  grupos,
  contexto,
  acoes,
}: {
  linhas: ResultadoDaLinha[];
  grupos: GrupoDeIguais<MovimentoDaLinha>[];
  contexto: ContextoDasCelulas;
  acoes: AcoesDoBanco;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1250px] table-fixed text-sm">
        <Colunas />
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-left">Histórico do banco</th>
            <th className="px-3 py-2 text-right">Crédito</th>
            <th className="px-3 py-2 text-right">Débito</th>
            <th className="px-3 py-2 text-left">Situação</th>
            <th className="px-3 py-2 text-left">No sistema</th>
            <th className="px-3 py-2 text-left">
              <span className="ml-auto block w-[200px] pl-1">Ação</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <GrupoNaTabela key={`${g.chave}|${g.linhas.map((r) => r.mov.id).join(",")}`} g={g} contexto={contexto} acoes={acoes} />
          ))}
          {linhas.map((r) => (
            <tr key={r.mov.id} className="border-b border-border last:border-0">
              <CelulasDoBanco r={r} />
              <td className="px-3 py-2">
                <Situacao r={r} />
              </td>
              <td className="px-3 py-2">
                {r.resolvido ? (
                  <p className="truncate text-xs" title={r.resolvido.texto}>
                    {r.resolvido.texto}
                  </p>
                ) : (
                  <NoSistema r={r} contexto={contexto} />
                )}
                {!r.resolvido && r.motivo && r.estado !== "sem_par" && (
                  <p className="truncate text-[10.5px] text-muted-foreground/80" title={r.motivo}>
                    {r.motivo}
                  </p>
                )}
              </td>
              <td className="px-3 py-2">
                <AcoesDaLinha r={r} acoes={acoes} contexto={contexto} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Data, histórico, crédito e débito: as colunas do banco. */
function CelulasDoBanco({ r }: { r: ResultadoDaLinha }) {
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(r.mov.data)}</td>
      <td className="px-3 py-2 font-mono text-[11px]">
        <span className="block truncate" title={r.mov.historico}>
          {r.mov.historico}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{r.mov.valor > 0 ? moeda(r.mov.valor) : ""}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{r.mov.valor < 0 ? moeda(-r.mov.valor) : ""}</td>
    </>
  );
}

function Situacao({ r }: { r: ResultadoDaLinha }) {
  if (r.resolvido)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
        <CheckCheck className="h-3.5 w-3.5" />
        {r.resolvido.estado === "ignorado" ? "Ignorado" : r.resolvido.sozinho ? "Conciliado sozinho" : "Conciliado"}
      </span>
    );
  const m: Record<ResultadoDaLinha["estado"], [string, string]> = {
    sugestao: ["Título encontrado", "text-emerald-700"],
    soma: ["Remessa encontrada", "text-emerald-700"],
    combinacao: [r.confianca === "alta" ? "Soma encontrada" : "Vários títulos", r.confianca === "alta" ? "text-emerald-700" : "text-amber-700"],
    diferenca: ["Valor diferente", "text-amber-700"],
    ja_lancado: ["Já lançado", "text-sky-700"],
    divergencia: ["Baixa diverge", "text-california-red"],
    par: ["Saiu e voltou", "text-violet-700"],
    regra: ["Regra", "text-violet-700"],
    sem_par: ["Sem correspondência", "text-california-red"],
  };
  const [texto, cor] = m[r.estado];
  return <span className={cn("whitespace-nowrap text-xs font-semibold", cor)}>{texto}</span>;
}

/** O centro de custo do título, como a planilha o diz por inteiro. */
function textoDoCentro(l: Linha | undefined): string {
  if (!l) return "";
  switch (l.centro.tipo) {
    case "plano":
      return ` · ${l.centro.completo}`;
    case "definir_na_baixa":
      return " · centro de custo na baixa";
    case "fora_do_dre":
      return " · fora do DRE";
    case "itens_da_fatura":
      return " · itens da fatura";
  }
}

/** A etiqueta, a descrição e o ⓘ do título — os mesmos da planilha. */
function TituloNaCelula({ t, l }: { t: TituloDoMotor; l: Linha | undefined }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
      {l && (
        <span
          className={cn(
            "inline-block shrink-0 whitespace-nowrap rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide",
            TOM_DA_ETIQUETA[l.etiqueta.tom],
          )}
        >
          {l.etiqueta.texto}
        </span>
      )}
      <span className="truncate" title={l?.descricao ?? t.ref}>
        {l?.descricao ?? t.ref}
      </span>
      {l && (
        <span className="shrink-0 scale-90">
          <BotaoDetalhes
            chave={l.chave}
            titulo={l.descricao}
            recebimento={l.entra}
            job={l.job}
            vencimentoDiferente={l.vencimento && l.vencimento !== l.dataPrevista ? l.vencimento : null}
            retencoes={l.valor.retencoes}
            rateio={l.rateio}
            acoes={[]}
          />
        </span>
      )}
    </p>
  );
}

/** O que o sistema tem para a linha do banco, em uma célula. */
function NoSistema({ r, contexto }: { r: ResultadoDaLinha; contexto: ContextoDasCelulas }) {
  if (r.estado === "ja_lancado" && r.lancamento) {
    const l = contexto.lancamentos.get(r.lancamento.id);
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold" title={r.lancamento.descricao}>
          {r.lancamento.descricao}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          Já no Extrato em {dataBR(r.lancamento.data)}
          {l?.fornecedor ? ` · ${l.fornecedor}` : ""}
          {r.lancamento.juros ? ` · inclui ${moeda(r.lancamento.juros)} de juros` : ""}
        </p>
      </div>
    );
  }
  if (r.estado === "soma" && r.lote)
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{r.lote.descricao ?? r.lote.nome}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {r.lote.titulos.length} títulos · soma {moeda(r.lote.total)}
        </p>
      </div>
    );
  if (r.estado === "combinacao" && r.titulos?.length) {
    const ts = r.titulos;
    const mesmoDia = ts.every((t) => t.vencimento === ts[0].vencimento);
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">
          {ts.map((t) => t.ref).join(" + ")} · {ts[0].contraparte}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {ts.length} títulos · {ts.map((t) => moeda(t.liquido)).join(" + ")} ·{" "}
          {mesmoDia ? `vencem ${dataBR(ts[0].vencimento)}` : `vencem ${ts.map((t) => dataBR(t.vencimento).slice(0, 5)).join(", ")}`}
        </p>
      </div>
    );
  }
  if (r.estado === "regra" && r.regra) {
    const g = r.regra.id ? contexto.regraPorId.get(r.regra.id) : undefined;
    const nome = r.regra.centro.split(" · ").pop() ?? r.regra.centro;
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">
          {nome} · {r.mov.historico.replace(/\s+\S*\d{6,}.*$/, "")}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          Lançamento novo · {r.regra.centro}
          {g ? ` · ${g.empresa}` : ""}
        </p>
      </div>
    );
  }
  if (r.estado === "par")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">
          {r.mov.valor > 0 ? "Devolução do PIX" : "PIX que voltou"}
          {r.titulo ? ` · ${r.titulo.ref} · ${r.titulo.contraparte}` : ""}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">Saída e devolução no mesmo dia: as duas entram no extrato e o título continua a pagar.</p>
      </div>
    );
  if (r.estado === "divergencia" && r.lancamento)
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold" title={r.lancamento.descricao}>
          {r.lancamento.descricao}
        </p>
        <p className="truncate text-[11px] font-semibold text-california-red">
          Baixa de {moeda(Math.abs(r.lancamento.valor))} em {dataBR(r.lancamento.data)} · {moeda(Math.abs(r.diferencaBaixa ?? 0))}{" "}
          {(r.diferencaBaixa ?? 0) > 0 ? "a mais" : "a menos"} que o banco
        </p>
      </div>
    );
  if (r.titulo) {
    const l = contexto.linhaPorChave.get(r.titulo.id);
    return (
      <div className="min-w-0">
        <TituloNaCelula t={r.titulo} l={l} />
        <p className="truncate text-[11px] text-muted-foreground">
          {r.titulo.contraparte} · vence {dataBR(r.titulo.vencimento)}
          {textoDoCentro(l)}
          {r.diferenca ? ` · título de ${moeda(r.titulo.liquido)}` : r.retencaoSugerida ? ` · nota de ${moeda(r.titulo.valor)}, com retenção` : ""}
        </p>
      </div>
    );
  }
  return <p className="text-xs italic text-muted-foreground">{r.motivo}</p>;
}

// ---------------------------------------------------------------------------
// A célula de ação
// ---------------------------------------------------------------------------

const BASE = "inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60";
const VERDE = `${BASE} bg-emerald-600 text-white hover:bg-emerald-700`;
const CONTORNO = `${BASE} border border-border bg-white text-foreground hover:bg-muted`;
const ICONE = "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60";

function Vagas({ principal, segundo, terceiro }: { principal?: React.ReactNode; segundo?: React.ReactNode; terceiro?: React.ReactNode }) {
  return (
    <span className="ml-auto grid w-[200px] grid-cols-[136px_28px_28px] items-center gap-1">
      <span>{principal}</span>
      <span>{segundo}</span>
      <span>{terceiro}</span>
    </span>
  );
}

function AcoesDaLinha({ r, acoes, contexto }: { r: ResultadoDaLinha; acoes: AcoesDoBanco; contexto: ContextoDasCelulas }) {
  const off = acoes.ocupado;
  const procurar = (titulo: string) => (
    <button type="button" title={titulo} aria-label={titulo} disabled={off} onClick={() => acoes.procurar(r)} className={ICONE}>
      <Search className="h-3.5 w-3.5" />
    </button>
  );
  const ignorar = (
    <button
      type="button"
      title="Ignorar esta linha"
      aria-label="Ignorar esta linha"
      disabled={off}
      onClick={() => acoes.ignorar(r)}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-california-red hover:bg-california-red/10 disabled:cursor-wait disabled:opacity-60"
    >
      <CircleSlash className="h-3.5 w-3.5" />
    </button>
  );

  if (r.resolvido)
    return (
      <Vagas
        principal={
          <span className={cn(BASE, r.resolvido.estado === "ignorado" ? "text-muted-foreground" : "text-emerald-700")}>
            <CheckCheck className="h-3 w-3" />
            {r.resolvido.estado === "ignorado" ? "Ignorado" : "Conciliado"}
          </span>
        }
        segundo={
          <button type="button" title="Desfazer" aria-label="Desfazer" disabled={off} onClick={() => acoes.desfazer(r)} className={ICONE}>
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        }
      />
    );
  switch (r.estado) {
    case "ja_lancado":
      return (
        <Vagas
          principal={
            <button type="button" disabled={off} onClick={() => acoes.ligar(r)} className={VERDE}>
              <Link2 className="h-3 w-3" />
              Conciliar
            </button>
          }
        />
      );
    case "divergencia": {
      const corrigivel = r.lancamento ? contexto.lancamentos.get(r.lancamento.id)?.corrigivel : false;
      return (
        <Vagas
          principal={
            corrigivel ? (
              <button type="button" disabled={off} onClick={() => acoes.corrigirBaixa(r)} className={VERDE} title="Corrige a baixa para o valor do banco e concilia">
                <CheckCheck className="h-3 w-3" />
                Corrigir a baixa
              </button>
            ) : (
              <span className="block text-center text-[10.5px] leading-tight text-muted-foreground" title="Cancele a baixa e baixe de novo pela linha do banco">
                corrija pela baixa
              </span>
            )
          }
          segundo={procurar("Era outro pagamento: procurar o título")}
        />
      );
    }
    case "sugestao":
    case "diferenca":
      return (
        <Vagas
          principal={
            r.confianca === "alta" && comCentro(r.titulo) && r.estado === "sugestao" ? (
              <button type="button" disabled={off} onClick={() => acoes.baixarEConciliar(r)} className={VERDE}>
                <CheckCheck className="h-3 w-3" />
                Baixar e conciliar
              </button>
            ) : (
              <button type="button" disabled={off} onClick={() => acoes.conferir(r)} className={CONTORNO}>
                <CheckCheck className="h-3 w-3" />
                Conferir
              </button>
            )
          }
          segundo={procurar("Escolher outro título")}
        />
      );
    case "combinacao": {
      const n = r.titulos?.length ?? 0;
      const pronta = r.confianca === "alta" && (r.titulos ?? []).every((t) => comCentro(t));
      return (
        <Vagas
          principal={
            pronta ? (
              <button type="button" disabled={off} onClick={() => acoes.conciliarCombinacao(r)} className={VERDE}>
                <CheckCheck className="h-3 w-3" />
                Baixar e conciliar os {n}
              </button>
            ) : (
              <button type="button" disabled={off} onClick={() => acoes.conferirCombinacao(r)} className={CONTORNO}>
                <CheckCheck className="h-3 w-3" />
                Conferir os {n}
              </button>
            )
          }
          segundo={procurar("Escolher outros títulos")}
        />
      );
    }
    case "soma":
      return (
        <Vagas
          principal={
            <button type="button" disabled={off} onClick={() => acoes.conciliarLote(r)} className={VERDE}>
              <CheckCheck className="h-3 w-3" />
              Baixar os {r.lote?.titulos.length ?? 0}
            </button>
          }
        />
      );
    case "par":
      return (
        <Vagas
          principal={
            r.mov.valor > 0 ? (
              <button type="button" disabled={off} onClick={() => acoes.conciliarPar(r)} className={VERDE}>
                <ArrowLeftRight className="h-3 w-3" />
                Registrar as duas
              </button>
            ) : (
              <span className="block text-center text-[10.5px] leading-tight text-muted-foreground">com a devolução</span>
            )
          }
        />
      );
    case "regra":
      return (
        <Vagas
          principal={
            <button type="button" disabled={off} onClick={() => acoes.lancarRegra([r])} className={VERDE}>
              <Wand2 className="h-3 w-3" />
              Lançar
            </button>
          }
          terceiro={ignorar}
        />
      );
    default:
      return (
        <Vagas
          principal={
            <button type="button" disabled={off} onClick={() => acoes.lancarAvulso(r)} className={CONTORNO}>
              <Plus className="h-3 w-3" />
              Lançar avulso
            </button>
          }
          segundo={procurar("Procurar um título")}
          terceiro={ignorar}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// O grupo de linhas iguais
// ---------------------------------------------------------------------------

/**
 * As linhas iguais do banco (mesmo dia, mesmo valor) com mais títulos que
 * linhas: uma faixa com o que o grupo é e o botão de todas, e cada linha com
 * as mesmas colunas das outras e o título escolhido para ela, que se troca
 * ("Trocar…": o escolhido de outra linha troca de lugar).
 */
function GrupoNaTabela({ g, contexto, acoes }: { g: GrupoDeIguais<MovimentoDaLinha>; contexto: ContextoDasCelulas; acoes: AcoesDoBanco }) {
  const linhas = React.useMemo(() => [...g.linhas].sort((a, b) => a.mov.ordem - b.mov.ordem), [g.linhas]) as ResultadoDaLinha[];
  const [escolha, setEscolha] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(linhas.map((r) => [r.mov.id, (r.titulo as TituloDoMotor).id])),
  );
  const porId = new Map(g.titulos.map((t) => [t.id, t]));
  const escolhidos = linhas.map((r) => porId.get(escolha[r.mov.id]) as TituloDoMotor);
  const sobram = g.titulos.filter((t) => !Object.values(escolha).includes(t.id));
  const semCentro = escolhidos.filter((t) => !comCentro(t));
  const trocar = (linhaId: string, id: string) =>
    setEscolha((e) => {
      const outra = Object.keys(e).find((k) => k !== linhaId && e[k] === id);
      return outra ? { ...e, [linhaId]: id, [outra]: e[linhaId] } : { ...e, [linhaId]: id };
    });
  const n = linhas.length;
  const m = g.titulos.length;
  const valor = moeda(Math.abs(linhas[0].mov.valor));
  const aPagar = linhas[0].mov.valor < 0 ? "a pagar" : "a receber";
  return (
    <>
      <tr className="border-b border-amber-200 bg-amber-50/70">
        <td colSpan={7} className="px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[12px] font-semibold text-amber-900">
              {n === 1 ? `1 linha de ${valor} no banco` : `${n} linhas de ${valor} no banco, no mesmo dia`} · {m} títulos de {valor} {aPagar}
            </span>
            <span className="min-w-[280px] flex-1 text-[11.5px] text-amber-900/80">
              {sobram.length > 0 && (
                <>
                  Fica em aberto: <strong>{sobram.map((t) => `${t.ref} · ${t.contraparte}`).join("; ")}</strong>
                </>
              )}
            </span>
            {n > 1 && (
              <button
                type="button"
                disabled={semCentro.length > 0 || acoes.ocupado}
                title={semCentro.length ? `Sem centro de custo: ${semCentro.map((t) => t.ref).join(", ")}. Baixe pela linha.` : undefined}
                onClick={() => acoes.conciliarGrupo(linhas, escolhidos)}
                className="inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCheck className="h-3 w-3" />
                Baixar e conciliar as {n}
              </button>
            )}
          </div>
        </td>
      </tr>
      {linhas.map((r, i) => {
        const t = porId.get(escolha[r.mov.id]) as TituloDoMotor;
        const l = contexto.linhaPorChave.get(t.id);
        const dias = Math.round((Date.parse(r.mov.data) - Date.parse(t.vencimento)) / 86400000);
        return (
          <tr key={r.mov.id} className="border-b border-border">
            <CelulasDoBanco r={r} />
            <td className="px-3 py-2">
              <span className="whitespace-nowrap text-xs font-semibold text-amber-700">{n === 1 ? "Mesmo valor" : `Linha ${i + 1} de ${n}`}</span>
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TituloNaCelula t={t} l={l} />
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t.contraparte} · vence {dataBR(t.vencimento)}
                    {dias !== 0 && (
                      <span className="text-amber-700">
                        {" "}
                        (o banco pagou {Math.abs(dias)} {Math.abs(dias) === 1 ? "dia" : "dias"} {dias > 0 ? "depois" : "antes"})
                      </span>
                    )}
                    {textoDoCentro(l)}
                  </p>
                </div>
                <select
                  aria-label="Trocar o título desta linha"
                  value=""
                  onChange={(e) => e.target.value && trocar(r.mov.id, e.target.value)}
                  className="h-7 w-[92px] shrink-0 rounded-md border border-border bg-white px-1.5 text-[11px] font-semibold text-muted-foreground hover:border-california-red/50"
                >
                  <option value="">Trocar…</option>
                  {g.titulos
                    .filter((x) => x.id !== t.id)
                    .map((x) => {
                      const deOutra = Object.entries(escolha).some(([k, id]) => k !== r.mov.id && id === x.id);
                      return (
                        <option key={x.id} value={x.id}>
                          {x.ref} · {x.contraparte} · vence {dataBR(x.vencimento).slice(0, 5)}
                          {deOutra ? " (troca com a outra linha)" : " (em aberto)"}
                        </option>
                      );
                    })}
                </select>
              </div>
            </td>
            <td className="px-3 py-2">
              <Vagas
                principal={
                  <button
                    type="button"
                    disabled={acoes.ocupado}
                    onClick={() => (comCentro(t) ? acoes.conciliarGrupo([r], [t]) : acoes.conferirTitulo(r, t))}
                    className={CONTORNO}
                  >
                    <CheckCheck className="h-3 w-3" />
                    {comCentro(t) ? "Baixar e conciliar" : "Conferir"}
                  </button>
                }
                segundo={
                  <button
                    type="button"
                    title="Procurar outro título"
                    aria-label="Procurar outro título"
                    disabled={acoes.ocupado}
                    onClick={() => acoes.procurar(r)}
                    className={ICONE}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                }
              />
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Baixa no sistema, sem linha no banco
// ---------------------------------------------------------------------------

/**
 * As baixas, com data num dia completo do extrato importado, que não têm
 * linha no banco. Pagas em outra conta, com a data errada ou não pagas: a
 * conciliação não fecha até cada uma ser resolvida.
 */
export function SemLinhaNoBanco({ lancs, acoes }: { lancs: LancamentoSemLinha[]; acoes: AcoesDoBanco }) {
  return (
    <section className="overflow-hidden rounded-xl border border-red-200 bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50/60 px-4 py-2.5">
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-california-red" />
          <span className="text-sm font-semibold">Baixa no sistema, sem linha no banco</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{lancs.length}</span>
        </span>
        <span className="min-w-[200px] flex-1 text-xs text-muted-foreground">
          Baixas feitas à mão, em dias que o extrato importado já cobre por inteiro, que o banco não mostra: pagas em outra
          conta, com a data errada, ou não pagas. Corrija a baixa ou cancele-a; até lá, a conciliação não fecha.
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1250px] table-fixed text-sm">
          <Colunas />
          <tbody>
            {lancs.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(l.data)}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="block truncate font-semibold" title={l.descricao}>
                    {l.descricao}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{l.fornecedor ?? "—"}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{l.valor > 0 ? moeda(l.valor) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{l.valor < 0 ? moeda(-l.valor) : ""}</td>
                <td className="px-3 py-2">
                  <span className="whitespace-nowrap text-xs font-semibold text-california-red">Não está no banco</span>
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">
                  Lançamento no Extrato desta conta. O banco não tem {l.valor < 0 ? "débito" : "crédito"} de {moeda(Math.abs(l.valor))}{" "}
                  entre as linhas importadas.
                </td>
                <td className="px-3 py-2">
                  <Vagas
                    principal={
                      l.cancelamento ? (
                        <button
                          type="button"
                          disabled={acoes.ocupado}
                          onClick={() => acoes.cancelarBaixa(l)}
                          className="inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-california-red/40 bg-white px-2 text-[11px] font-semibold text-california-red hover:bg-california-red/5 disabled:cursor-wait disabled:opacity-60"
                        >
                          <Undo2 className="h-3 w-3" />
                          Cancelar a baixa
                        </button>
                      ) : undefined
                    }
                    segundo={
                      <Link
                        href={acoes.linkDoLancamento(l)}
                        prefetch={false}
                        title="Corrigir a conta ou a data da baixa"
                        aria-label="Corrigir a conta ou a data da baixa"
                        className={ICONE}
                      >
                        <Search className="h-3.5 w-3.5" />
                      </Link>
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
