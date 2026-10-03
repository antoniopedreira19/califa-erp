/**
 * Pedaços de tela da aba Apuração (os mesmos do protótipo aprovado, que os
 * copiou das telas reais do financeiro) e os textos/valores que a aba e a
 * memória de cálculo dividem.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { ultimoDiaDoMes } from "@/lib/fiscal/datas";
import type { GuiaDaTela } from "./dados";

export const moeda = formatBRL;

/** 1.65 → "1,65%". */
export const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;

/** "Nome · DARF 2362". */
export const nomeGuia = (g: Pick<GuiaDaTela, "titulo" | "codigo">) => `${g.titulo}${g.codigo ? ` · DARF ${g.codigo}` : ""}`;

/** O último dia do período ("2026-10" → 31/10; "2026-T4" → 31/12). */
export function fimDoPeriodo(periodo: "mensal" | "trimestral", competencia: string) {
  if (periodo === "mensal") return ultimoDiaDoMes(competencia);
  const [y, q] = competencia.split("-T").map(Number);
  return ultimoDiaDoMes(`${y}-${String(q * 3).padStart(2, "0")}`);
}

export const somaGrupo = (g: Pick<GuiaDaTela, "memoria">, grupos: string[]) =>
  Math.round(g.memoria.filter((m) => grupos.includes(m.grupo)).reduce((s, m) => s + m.valor, 0) * 100) / 100;

export function Pilula({
  tom,
  children,
}: {
  tom: "ambar" | "verde" | "cinza" | "rosa";
  children: React.ReactNode;
}) {
  const cls = {
    ambar: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
    verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
    cinza: "border-border bg-muted text-muted-foreground",
    rosa: "border-rose-200 bg-rose-50 text-rose-700",
  }[tom];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        cls,
      )}
    >
      {children}
    </span>
  );
}

export function situacaoDa(g: Pick<GuiaDaTela, "estado" | "apurado">) {
  if (g.estado === "em_curso") return <Pilula tom="cinza">Em curso</Pilula>;
  if (g.estado === "a_aprovar")
    return g.apurado > 0 ? <Pilula tom="ambar">A aprovar</Pilula> : <Pilula tom="ambar">A confirmar</Pilula>;
  if (g.estado === "diferenca") return <Pilula tom="rosa">Diferença</Pilula>;
  return <Pilula tom="verde">Aprovada</Pilula>;
}

export function ResumoItem({
  icone,
  label,
  valor,
  extra,
}: {
  icone: React.ReactNode;
  label: string;
  valor: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {icone}
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{valor}</span>
      {extra}
    </div>
  );
}

export function Nota({
  children,
  tom = "cinza",
  icone,
}: {
  children: React.ReactNode;
  tom?: "cinza" | "ambar" | "azul";
  icone?: React.ReactNode;
}) {
  const cls = {
    cinza: "border-border bg-muted/40 text-muted-foreground",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    azul: "border-sky-200 bg-sky-50 text-sky-900",
  }[tom];
  return (
    <div className={cn("flex gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed", cls)}>
      {icone && <span className="mt-0.5 shrink-0">{icone}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
