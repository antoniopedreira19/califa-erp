"use client";

/**
 * As peças das células da Conciliação automática: o contrato das ações com a
 * aba, o que o sistema tem para cada linha do banco (`NoSistema`) e os botões.
 * A fila que as usa (decisão 234) mora em fila-dividida.tsx; as seções
 * separadas, cada uma com a sua tabela, saíram com ela.
 */

import * as React from "react";
import { CelulaDoMutuo } from "./mutuo-na-linha";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { TituloDoMotor } from "@/lib/conciliacao/motor";
import { BotaoDetalhes } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import { dataBR, TOM_DA_ETIQUETA } from "@/components/financeiro/planilha-de-titulos/planilha";
import type { LancamentoSemLinha, RegraDaConta } from "./banco-dados";
import type { Linha } from "./linhas-da-aba";
import type { ResultadoDaLinha } from "./motor-da-conta";
import type { SelecaoDoAgrupamento } from "./agrupar-lancamentos";

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
  /** A cauda do histórico da planilha (decisão 211, A6). */
  conciliarHistorico: (rs: ResultadoDaLinha[]) => void;
  /** Uma regra para o histórico desta linha (lançamento ou transferência). */
  criarRegra: (r: ResultadoDaLinha) => void;
  lancarAvulso: (r: ResultadoDaLinha) => void;
  lancarMutuo: (r: ResultadoDaLinha) => void;
  lancarNotas: (r: ResultadoDaLinha) => void;
  lancarIof: (r: ResultadoDaLinha) => void;
  procurar: (r: ResultadoDaLinha) => void;
  ignorar: (r: ResultadoDaLinha) => void;
  desfazer: (r: ResultadoDaLinha) => void;
  corrigirBaixa: (r: ResultadoDaLinha) => void;
  cancelarBaixa: (l: LancamentoSemLinha) => void;
  /** "Agrupar lançamentos" (decisão 234): abre o pop-up com estes itens
   *  marcados — várias linhas do banco com várias baixas, quando a soma só
   *  bate no conjunto (antes "Conciliar em conjunto", decisão 211). */
  agrupar: (s: SelecaoDoAgrupamento) => void;
  /** O agrupamento achado pelo sistema, conciliado direto. */
  conciliarAgrupamento: (linhaIds: string[], lancamentoIds: string[], datas: string[]) => void;
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

export type Cor = "emerald" | "amber" | "violet" | "red" | "sky" | "neutral";

export const COR_DO_PONTO: Record<Cor, string> = {
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

/** A pílula da Situação: a cor do texto, com fundo e borda claros. */
export function Pilula({ cor, children, title }: { cor: string; children: React.ReactNode; title?: string }) {
  const fundo: Record<string, string> = {
    "text-emerald-700": "border-emerald-200 bg-emerald-50",
    "text-amber-700": "border-amber-200 bg-amber-50",
    "text-sky-700": "border-sky-200 bg-sky-50",
    "text-violet-700": "border-violet-200 bg-violet-50",
    "text-california-red": "border-red-200 bg-red-50",
    "text-muted-foreground": "border-border bg-muted/50",
  };
  return (
    <span title={title} className={cn("inline-flex max-w-full items-center gap-1 truncate whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cor, fundo[cor] ?? "border-border bg-muted/50")}>
      {children}
    </span>
  );
}

/** O centro de custo do título, como a planilha o diz por inteiro. */
export function textoDoCentro(l: Linha | undefined): string {
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
export function TituloNaCelula({ t, l }: { t: TituloDoMotor; l: Linha | undefined }) {
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
export function NoSistema({ r, contexto }: { r: ResultadoDaLinha; contexto: ContextoDasCelulas }) {
  if (r.mutuo) return <CelulaDoMutuo r={r} m={r.mutuo} />;
  if (r.estado === "historico" && r.historicos?.length) {
    const hs = r.historicos;
    const jobs = [...new Set(hs.map((h) => h.job ?? h.descricao ?? "sem job"))];
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold" title={jobs.join(" · ")}>
          {jobs[0]}
          {jobs.length > 1 ? ` e mais ${jobs.length - 1}` : ""}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          Histórico da planilha · {hs.length === 1 ? `linha de ${dataBR(hs[0].data)}` : `${hs.length} linhas de ${dataBR(hs[0].data)} que somam o banco`} ·
          sem lançamento no sistema
        </p>
      </div>
    );
  }
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
          {g?.contaDestinoId ? (
            <>Transferência nova entre as contas, no sentido do banco · {r.regra.centro}</>
          ) : (
            <>
              Lançamento novo · {r.regra.centro}
              {g ? ` · ${g.empresa}` : ""}
            </>
          )}
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
// Os botões da célula de ação
// ---------------------------------------------------------------------------

const BASE = "inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60";
export const VERDE = `${BASE} bg-emerald-600 text-white hover:bg-emerald-700`;
export const CONTORNO = `${BASE} border border-border bg-white text-foreground hover:bg-muted`;
