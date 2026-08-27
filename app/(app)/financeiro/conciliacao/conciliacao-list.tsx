"use client";
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";

export function ConciliacaoList({
  linhas,
  highlight,
}: {
  linhas: LancamentoLinha[];
  highlight?: string;
}) {
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  // Transação com mais de uma origem abre um detalhe embaixo dela, com o
  // rateio. Fechada por padrão: o extrato é denso, e a maioria das linhas
  // tem origem única (docs/decisions/028-save-entre-jobs.md).
  const [abertas, setAbertas] = React.useState<Set<string>>(new Set());
  const alternar = (id: string) =>
    setAbertas((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

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
          {/* O dinheiro vem logo depois da data (27/08/2026): é a ordem em
              que se lê um extrato bancário, e era o que obrigava a
              atravessar a tela inteira para conferir valor contra data.

              Tipo e Subtipo são DUAS colunas. Até aqui havia uma só,
              chamada "Tipo", que mostrava o código do tipo com o nome do
              subtipo ("05 · Salário") — o nome do tipo ("Despesa com
              Pessoal") não aparecia em lugar nenhum da tela. */}
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-right">Crédito</th>
            <th className="px-3 py-2 text-right">Débito</th>
            <th className="px-3 py-2 text-right">Saldo</th>
            <th className="px-3 py-2 text-left">Descrição</th>
            <th className="px-3 py-2 text-left">Fornecedor</th>
            <th className="px-3 py-2 text-left">Job</th>
            <th className="px-3 py-2 text-left">Tipo</th>
            <th className="px-3 py-2 text-left">Subtipo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            // Tem detalhe quando o dinheiro vem de mais de um lugar: dois
            // ou mais jobs na nota, uma fatia em save, ou rateio de
            // regional.
            const temSave = l.origens.some((o) => o.tipo === "save");
            const temDetalhe = l.origens.length > 1 || l.rateio.length > 1;
            const aberta = abertas.has(l.id);
            return (
            <React.Fragment key={l.id}>
            <tr
              ref={(el) => {
                rowRefs.current[l.id] = el;
              }}
              className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
            >
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                {formatDate(l.data_movimento)}
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
                {temDetalhe && (
                  <button
                    type="button"
                    onClick={() => alternar(l.id)}
                    aria-expanded={aberta}
                    className="mr-2 inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-700 transition-colors hover:bg-slate-200"
                  >
                    {aberta ? (
                      <ChevronDown className="h-2.5 w-2.5" />
                    ) : (
                      <ChevronRight className="h-2.5 w-2.5" />
                    )}
                    Rateado
                  </button>
                )}
                {temSave && (
                  <span className="mr-2 inline-flex items-center rounded border border-[#c9c6bf] bg-[#f3f2ee] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#5f5d57]">
                    Save
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
                {l.tipo_nome}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="font-mono">{l.subtipo_codigo}</span> ·{" "}
                {l.subtipo_nome}
              </td>
            </tr>
            {aberta && (
              <tr className="border-b border-border bg-muted/20 last:border-0">
                <td colSpan={4} />
                <td colSpan={5} className="px-3 pb-3 pt-1">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                    De onde vem este dinheiro
                  </p>
                  <div className="flex flex-col gap-1">
                    {l.origens.map((o, i) => (
                      <div
                        key={`${o.tipo}-${o.codigo ?? i}`}
                        className="flex items-baseline justify-between gap-4 text-xs"
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="font-mono font-semibold">
                            {o.codigo ?? "—"}
                          </span>
                          <span className={o.tipo === "save" ? "text-[#5f5d57]" : ""}>
                            {o.tipo === "save"
                              ? "saldo em save — crédito do cliente"
                              : (o.nome ?? "")}
                          </span>
                        </span>
                        <span className="whitespace-nowrap font-mono font-semibold">
                          {formatMoney(o.valor)}
                        </span>
                      </div>
                    ))}
                    {l.rateio.length > 1 &&
                      l.rateio.map((r) => (
                        <div
                          key={r.regional_nome}
                          className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground"
                        >
                          <span>Regional {r.regional_nome}</span>
                          <span className="font-mono">
                            {r.percentual.toFixed(2)}%
                          </span>
                        </div>
                      ))}
                  </div>
                </td>
              </tr>
            )}
            </React.Fragment>
            );
          })}
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
