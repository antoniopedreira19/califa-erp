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

/** "PIS não cumulativo · DARF 6912": o nome por extenso (decisão 277) e o código. */
export const nomeGuia = (g: Pick<GuiaDaTela, "titulo" | "codigo">) => `${tituloPorExtenso(g)}${g.codigo ? ` · DARF ${g.codigo}` : ""}`;

/**
 * O que cada código de DARF quer dizer (decisão 277): a dica do código na
 * lista. O código é o número impresso na guia que diz à Receita qual imposto
 * está sendo pago.
 */
export const NOME_DO_CODIGO: Record<string, string> = {
  "6912": "PIS não cumulativo, do lucro real",
  "5856": "COFINS não cumulativa, do lucro real",
  "8109": "PIS cumulativo: lucro presumido e a receita do 12.08",
  "2172": "COFINS cumulativa: lucro presumido e a receita do 12.08",
  "0220": "IRPJ do lucro real, trimestral",
  "6012": "CSLL do lucro real, trimestral",
  "2089": "IRPJ do lucro presumido",
  "2372": "CSLL do lucro presumido",
  "5952": "PIS, COFINS e CSLL retidos de fornecedores",
  "1708": "IRRF retido sobre serviços de fornecedores",
  "1150": "IOF do mútuo entre empresas",
};

/** O nome da guia por extenso: "PIS" sozinho, no lucro real, é o não cumulativo. */
export function tituloPorExtenso(g: Pick<GuiaDaTela, "titulo" | "codigo">) {
  if (g.codigo === "6912") return "PIS não cumulativo";
  if (g.codigo === "5856") return "COFINS não cumulativa";
  return g.titulo;
}

/** O nome da guia na lista: por extenso, com o código do DARF numa linha menor e a explicação na dica. */
export function NomeDaGuia({ g }: { g: Pick<GuiaDaTela, "titulo" | "codigo"> }) {
  return (
    <>
      <span className="font-semibold">{tituloPorExtenso(g)}</span>
      {g.codigo && (
        <span
          className="mt-0.5 block w-fit cursor-help font-mono text-[10.5px] text-muted-foreground"
          title={`Código do DARF ${g.codigo}: ${NOME_DO_CODIGO[g.codigo] ?? "imposto federal"}. É o número impresso na guia que diz à Receita qual imposto está sendo pago.`}
        >
          DARF {g.codigo}
        </span>
      )}
    </>
  );
}

/** "19437976000154" → "19.437.976/0001-54". */
export const cnpjBr = (c: string | null | undefined) =>
  c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c ?? "—";

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
