"use client";

/**
 * O navegador de período das Notas Fiscais (decisão 271): sem "De" e "Até".
 * ‹ Novembro de 2026 › com Mês, Trimestre, Ano e Tudo. As abas abrem em
 * "Tudo" (todas as notas, sem período); Mês, Trimestre e Ano partem sempre do
 * período atual, e as setas andam a partir dali.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Granularidade = "mes" | "tri" | "ano" | "tudo";
/** A janela de tempo: a granularidade e o mês de referência ("AAAA-MM"). */
export interface Janela {
  gran: Granularidade;
  ref: string;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const pad = (n: number) => String(n).padStart(2, "0");

/** As abas abrem em "Tudo". */
export function janelaInicial(hoje: string): Janela {
  return { gran: "tudo", ref: hoje.slice(0, 7) };
}

/** O primeiro e o último dia da janela. */
export function intervaloDaJanela(j: Janela): { de: string; ate: string } {
  if (j.gran === "tudo") return { de: "0000-01-01", ate: "9999-12-31" };
  const [ano, mes] = j.ref.split("-").map(Number);
  if (j.gran === "ano") return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
  const ini = j.gran === "tri" ? Math.floor((mes - 1) / 3) * 3 + 1 : mes;
  const fim = j.gran === "tri" ? ini + 2 : mes;
  const ultimo = new Date(Date.UTC(ano, fim, 0)).getUTCDate();
  return { de: `${ano}-${pad(ini)}-01`, ate: `${ano}-${pad(fim)}-${pad(ultimo)}` };
}

export function rotuloDaJanela(j: Janela): string {
  if (j.gran === "tudo") return "Todo o período";
  const [ano, mes] = j.ref.split("-").map(Number);
  if (j.gran === "ano") return String(ano);
  if (j.gran === "tri") return `${Math.floor((mes - 1) / 3) + 1}º trimestre de ${ano}`;
  return `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)} de ${ano}`;
}

function andar(j: Janela, passo: -1 | 1): Janela {
  if (j.gran === "tudo") return j;
  const [ano, mes] = j.ref.split("-").map(Number);
  const meses = j.gran === "ano" ? 12 : j.gran === "tri" ? 3 : 1;
  const d = new Date(Date.UTC(ano, mes - 1 + passo * meses, 1));
  return { gran: j.gran, ref: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` };
}

export function naJanela(data: string, j: Janela): boolean {
  const { de, ate } = intervaloDaJanela(j);
  return data >= de && data <= ate;
}

/** ‹ Novembro de 2026 › · Mês | Trimestre | Ano — sem digitar datas. */
export function NavegadorDePeriodo({
  janela,
  onChange,
  hoje,
  rotulo = "Emissão",
  compacto,
}: {
  janela: Janela;
  onChange: (j: Janela) => void;
  hoje: string;
  rotulo?: string;
  /** Mais baixo (dentro de uma faixa). */
  compacto?: boolean;
}) {
  const tudo = janela.gran === "tudo";
  const alto = compacto ? "h-8" : "h-11";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</span>
      <div className={cn("inline-flex items-center rounded-lg border border-border bg-white", alto)}>
        <button
          type="button"
          onClick={() => onChange(andar(janela, -1))}
          disabled={tudo}
          aria-label="Período anterior"
          className={cn("inline-flex w-8 items-center justify-center text-muted-foreground hover:text-california-red disabled:pointer-events-none disabled:opacity-30", alto)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[164px] select-none px-1 text-center text-[13px] font-semibold">{rotuloDaJanela(janela)}</span>
        <button
          type="button"
          onClick={() => onChange(andar(janela, 1))}
          disabled={tudo}
          aria-label="Próximo período"
          className={cn("inline-flex w-8 items-center justify-center text-muted-foreground hover:text-california-red disabled:pointer-events-none disabled:opacity-30", alto)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className={cn("inline-flex rounded-lg border border-border bg-white p-0.5", alto)}>
        {(
          [
            ["mes", "Mês"],
            ["tri", "Trimestre"],
            ["ano", "Ano"],
            ["tudo", "Tudo"],
          ] as const
        ).map(([gran, nome]) => (
          <button
            key={gran}
            type="button"
            aria-pressed={janela.gran === gran}
            title={gran === "tudo" ? "Todas as notas, sem período" : undefined}
            // Mês, Trimestre e Ano partem sempre do período atual.
            onClick={() => onChange({ gran, ref: hoje.slice(0, 7) })}
            className={cn(
              "rounded-md px-2.5 text-[12px] font-semibold transition-colors",
              janela.gran === gran ? "bg-california-red text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {nome}
          </button>
        ))}
      </div>
    </div>
  );
}
