"use client";

import * as React from "react";
import { ChevronDown, EyeOff } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { AbaResumo } from "@/lib/importacao/tipos-da-importacao";
import { ORCADO, PLANEJADO } from "@/app/(app)/_planilha/blocos";

/**
 * A tabela de abas do arquivo (decisão 110, design 1C). Todas as abas lado
 * a lado — visíveis, ocultas e, recolhidas no fim, as que o ERP não lê,
 * com o motivo. Clicar numa linha troca o resumo ao lado.
 */

export function SeloDaAba({ visivel }: { visivel: boolean }) {
  return visivel ? (
    <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
      Visível
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <EyeOff className="h-3 w-3" />
      Oculta
    </span>
  );
}

function Radio({ marcado }: { marcado: boolean }) {
  return marcado ? (
    <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-california-red">
      <span className="h-2 w-2 rounded-full bg-california-red" />
    </span>
  ) : (
    <span className="block h-4 w-4 rounded-full border-2 border-[#c9c9c9] bg-white" />
  );
}

export function TabelaDeAbas({
  abas,
  selecionada,
  onSelecionar,
}: {
  abas: AbaResumo[];
  selecionada: string;
  onSelecionar: (nome: string) => void;
}) {
  const [verNaoLidas, setVerNaoLidas] = React.useState(false);
  const legiveis = abas.filter((a) => a.legivel);
  const naoLidas = abas.filter((a) => !a.legivel);
  const TH = "py-1.5 text-[10px] font-semibold uppercase tracking-wider";

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Abas do arquivo</span>
        <span className="font-medium normal-case tracking-normal">
          {legiveis.length === 1
            ? "1 aba no formato do orçamento"
            : `${legiveis.length} abas no formato do orçamento · clique para ler outra`}
        </span>
      </div>
      <table className="w-full table-fixed text-[13.5px]">
        <colgroup>
          <col style={{ width: 36 }} />
          <col />
          <col style={{ width: 80 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 48 }} />
          <col style={{ width: 116 }} />
          <col style={{ width: 116 }} />
        </colgroup>
        <thead>
          <tr className="text-muted-foreground">
            <th />
            <th className={cn(TH, "text-left")}>Aba</th>
            <th className={cn(TH, "text-left")}>No Excel</th>
            <th className={cn(TH, "pr-3 text-right")}>Grupos</th>
            <th className={cn(TH, "pr-3 text-right")}>Itens</th>
            <th className={cn(TH, "pr-3 text-right", ORCADO.texto)}>Orçado</th>
            <th className={cn(TH, "pr-3 text-right", PLANEJADO.texto)}>Planejado</th>
          </tr>
        </thead>
        <tbody>
          {legiveis.map((a) => {
            const marcada = a.nome === selecionada;
            return (
              <tr
                key={a.nome}
                onClick={() => onSelecionar(a.nome)}
                className={cn(
                  "cursor-pointer border-t border-border transition-colors",
                  marcada ? "bg-california-red/5" : "hover:bg-accent",
                )}
              >
                <td
                  className={cn(
                    "border-l-2 py-2 pl-3",
                    marcada ? "border-l-california-red" : "border-l-transparent",
                  )}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={marcada}
                    aria-label={`Ler a aba ${a.nome}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelecionar(a.nome);
                    }}
                    className="block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-california-red/40"
                  >
                    <Radio marcado={marcada} />
                  </button>
                </td>
                <td
                  className={cn(
                    "truncate py-2 pr-2 text-foreground",
                    marcada ? "font-semibold" : "font-medium",
                  )}
                  title={a.nome}
                >
                  {a.nome}
                </td>
                <td className="py-2">
                  <SeloDaAba visivel={a.visivel} />
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{a.grupos}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{a.itens}</td>
                <td className={cn("py-2 pr-3 text-right font-mono text-xs font-semibold", ORCADO.texto)}>
                  {formatCurrency(a.orcado, "BRL")}
                </td>
                <td className={cn("py-2 pr-3 text-right font-mono text-xs", PLANEJADO.texto)}>
                  {a.planejado > 0 ? formatCurrency(a.planejado, "BRL") : "—"}
                </td>
              </tr>
            );
          })}
          {naoLidas.length > 0 && (
            <tr className="border-t border-dashed border-border">
              <td colSpan={7} className="p-0">
                <button
                  type="button"
                  onClick={() => setVerNaoLidas((v) => !v)}
                  aria-expanded={verNaoLidas}
                  className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <span>
                    + {naoLidas.length}{" "}
                    {naoLidas.length === 1 ? "aba fora" : "abas fora"} do formato do orçamento
                  </span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", verNaoLidas && "rotate-180")} />
                </button>
              </td>
            </tr>
          )}
          {verNaoLidas &&
            naoLidas.map((a) => (
              <tr key={a.nome} className="border-t border-border text-xs text-muted-foreground/80">
                <td />
                <td className="truncate py-2 pr-2" title={a.nome}>
                  {a.nome}
                </td>
                <td className="py-2">
                  <SeloDaAba visivel={a.visivel} />
                </td>
                <td colSpan={4} className="py-2 pr-3 text-right" title={a.motivo ?? ""}>
                  <span className="line-clamp-2">{a.motivo}</span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
