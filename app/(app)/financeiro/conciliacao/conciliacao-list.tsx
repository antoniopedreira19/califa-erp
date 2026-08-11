"use client";
import * as React from "react";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";

export function ConciliacaoList({
  linhas,
  highlight,
}: {
  linhas: LancamentoLinha[];
  highlight?: string;
}) {
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});

  React.useEffect(() => {
    if (!highlight) return;
    const el = rowRefs.current[highlight];
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("animate-pulse", "bg-yellow-50");
      const timer = setTimeout(
        () => el.classList.remove("animate-pulse", "bg-yellow-50"),
        2000,
      );
      return () => clearTimeout(timer);
    }
  }, [highlight, linhas]);

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum lançamento nesse período pra essa conta.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-left">Descrição</th>
            <th className="px-3 py-2 text-left">Fornecedor</th>
            <th className="px-3 py-2 text-left">Job</th>
            <th className="px-3 py-2 text-left">Tipo</th>
            <th className="px-3 py-2 text-right">Crédito</th>
            <th className="px-3 py-2 text-right">Débito</th>
            <th className="px-3 py-2 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr
              key={l.id}
              ref={(el) => {
                rowRefs.current[l.id] = el;
              }}
              className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
            >
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                {formatDate(l.data_movimento)}
              </td>
              <td
                className={`px-3 py-2 ${
                  l.origem === "pp_baixa_estornada" || l.origem === "avulsa_baixa_estornada"
                    ? "text-muted-foreground line-through"
                    : ""
                }`}
              >
                {l.origem.startsWith("pp_") && (
                  <span className="mr-2 inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue-700">
                    PP
                  </span>
                )}
                {l.origem.startsWith("avulsa_") && (
                  <span className="mr-2 inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-700">
                    Avulsa
                  </span>
                )}
                {l.rateio && l.rateio.length > 1 && (
                  <span
                    className="ml-2 inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-700"
                    title={l.rateio
                      .map((r) => `${r.regional_nome}: ${r.percentual.toFixed(2)}%`)
                      .join("\n")}
                  >
                    Rateado
                  </span>
                )}
                {l.descricao}
              </td>
              <td className="px-3 py-2 text-xs">
                {l.fornecedor_nome ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {l.job_codigo ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="font-mono">{l.tipo_codigo}</span> ·{" "}
                {l.subtipo_nome}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-emerald-700">
                {l.credito > 0 ? formatMoney(l.credito) : ""}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-california-red">
                {l.debito > 0 ? formatMoney(l.debito) : ""}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                {formatMoney(l.saldo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
