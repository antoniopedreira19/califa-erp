"use client";

/**
 * Notas Fiscais (decisão 271): as peças das duas abas — os chips de
 * situação, o resumo, o selo da linha e a barra de busca, CNPJ e período.
 */
import * as React from "react";
import { Download, Loader2, Search } from "lucide-react";
import { MultiSelectCnpjs } from "@/app/(app)/financeiro/fiscal/apuracao/multi-select-cnpjs";
import { cn, formatCnpj } from "@/lib/utils";
import type { CnpjDaLista, OrigemDaNota } from "./dados";

export const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBR = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};
export const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function StatusChip({ ativo, onClick, label, count }: { ativo: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn("tabular-nums", ativo ? "text-white/85" : "text-muted-foreground/70")}>{count}</span>
      )}
    </button>
  );
}

export function ResumoItem({ icone, label, valor, detalhe }: { icone: React.ReactNode; label: string; valor: string; detalhe?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {icone}
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{valor}</span>
      {detalhe && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{detalhe}</span>}
    </div>
  );
}

export function Divisoria() {
  return <div className="h-5 w-px bg-border" />;
}

/** O selo da linha: as mesmas cores da planilha de títulos. */
const BASE_DO_SELO = "inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";
export const COR_DO_SELO = {
  ambar: "border-amber-200 bg-[#fffbeb] text-[#92400e]",
  azul: "border-sky-200 bg-sky-50 text-sky-700",
  verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
  vermelho: "border-red-200 bg-red-50 text-[#b3323c]",
  cinza: "border-border bg-muted text-muted-foreground",
} as const;

export function Selo({ cor, children, title }: { cor: keyof typeof COR_DO_SELO; children: React.ReactNode; title?: string }) {
  return (
    <span className={cn(BASE_DO_SELO, COR_DO_SELO[cor])} title={title}>
      {children}
    </span>
  );
}

/** "California · São Paulo" e o CNPJ embaixo. */
export function CelulaDoCnpj({ c }: { c: CnpjDaLista | null }) {
  if (!c) return <span className="text-xs text-muted-foreground">Não registrado</span>;
  return (
    <div className="min-w-0">
      <div className="truncate text-[13px]" title={c.nome}>
        {c.nome}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">{formatCnpj(c.cnpj)}</div>
    </div>
  );
}

/**
 * Busca, CNPJ e o navegador de período (decisão 271: sem "De" e "Até"). Tudo
 * filtra na tela: a página já lê as notas de todas as datas.
 */
export function FiltrosDasNotas({
  busca,
  onBusca,
  placeholder,
  cnpjs,
  rotuloCnpj,
  cnpjsMarcados,
  onCnpjs,
  navegador,
}: {
  busca: string;
  onBusca: (v: string) => void;
  placeholder: string;
  cnpjs: CnpjDaLista[];
  rotuloCnpj: string;
  cnpjsMarcados: string[];
  onCnpjs: (ids: string[]) => void;
  /** O navegador de período, à direita. */
  navegador: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <div className="min-w-[260px] flex-1 space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">Buscar</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder={placeholder}
            className="h-11 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">{rotuloCnpj}</label>
        <div className="[&_button]:h-11 [&_button]:w-[230px]">
          <MultiSelectCnpjs
            opcoes={cnpjs.map((c) => ({ id: c.id, nome: c.nome, cnpj: formatCnpj(c.cnpj) }))}
            selecionados={cnpjsMarcados}
            onSelectionChange={onCnpjs}
          />
        </div>
      </div>
      {navegador}
    </div>
  );
}

/** "Exportar Excel": o mesmo botão de Visualizar Jobs e Resultado de Job. */
export function BotaoExportar({ total, filtrado, onExportar }: { total: number; filtrado: boolean; onExportar: () => Promise<void> }) {
  const [exportando, setExportando] = React.useState(false);
  const [erro, setErro] = React.useState(false);
  async function exportar() {
    if (exportando || total === 0) return;
    setExportando(true);
    setErro(false);
    try {
      await onExportar();
    } catch (e) {
      console.error("[notas-fiscais.exportar]", e);
      setErro(true);
    } finally {
      setExportando(false);
    }
  }
  return (
    <div className="flex items-center gap-2.5">
      {erro && <span className="text-[12px] text-california-red">Não foi possível gerar a planilha. Tente de novo.</span>}
      <button
        type="button"
        onClick={exportar}
        disabled={exportando || total === 0}
        title={`${total === 1 ? "A nota da lista" : `As ${total} notas da lista`}${filtrado ? ", com os filtros aplicados" : ""}`}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {exportando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-california-red" />
        ) : (
          <Download className="h-3.5 w-3.5 text-california-red" />
        )}
        {exportando ? "Exportando…" : "Exportar Excel"}
      </button>
    </div>
  );
}

/** A origem da nota: o chip de Job/BV do Contas a Receber, com Save, Avulso e Histórico. */
export const ROTULO_DA_ORIGEM: Record<OrigemDaNota, string> = { job: "Job", bv: "BV", save: "Save", avulso: "Avulso", historico: "Histórico" };
const COR_DA_ORIGEM: Record<OrigemDaNota, string> = {
  job: "border-border bg-muted text-muted-foreground",
  bv: "border-violet-200 bg-violet-50 text-violet-700",
  save: "border-teal-200 bg-teal-50 text-teal-700",
  avulso: "border-sky-200 bg-sky-50 text-sky-700",
  historico: "border-dashed border-border bg-white text-muted-foreground",
};
export function ChipDaOrigem({ origem, title }: { origem: OrigemDaNota; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        COR_DA_ORIGEM[origem],
      )}
    >
      {ROTULO_DA_ORIGEM[origem]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// O corte das linhas
// ---------------------------------------------------------------------------

/**
 * A lista desenha as primeiras notas do filtro e mais a cada clique: com
 * "Tudo", as emitidas passam de 3.600 (o histórico da planilha), e desenhar
 * todas trava a tela. Os totais, a busca e a exportação continuam sobre
 * todas as notas do filtro.
 */
export const LINHAS_POR_VEZ = 200;

/** O limite volta ao início quando o filtro muda (`chave`). */
export function useLimiteDeLinhas(chave: string) {
  const [estado, setEstado] = React.useState({ chave, limite: LINHAS_POR_VEZ });
  const limite = estado.chave === chave ? estado.limite : LINHAS_POR_VEZ;
  return { limite, mais: () => setEstado({ chave, limite: limite + LINHAS_POR_VEZ }) };
}

export function MaisLinhas({ mostrando, total, onMais }: { mostrando: number; total: number; onMais: () => void }) {
  if (mostrando >= total) return null;
  const proximas = Math.min(LINHAS_POR_VEZ, total - mostrando);
  return (
    <div className="flex items-center justify-center gap-3 py-1 text-[12.5px] text-muted-foreground">
      <span>
        Mostrando {mostrando.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")} notas.
      </span>
      <button
        type="button"
        onClick={onMais}
        className="rounded-lg border border-border bg-white px-3 py-1.5 font-semibold text-foreground transition-colors hover:border-california-red hover:text-california-red"
      >
        Mostrar mais {proximas.toLocaleString("pt-BR")}
      </button>
    </div>
  );
}
