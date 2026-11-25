"use client";

/**
 * O rateio de uma guia entre as empresas e regionais, só para conferir
 * (decisão 277 §10, 25/11/2026). Nos impostos sobre a receita (ISS, PIS,
 * COFINS, IRPJ e CSLL) o sistema divide pela receita de cada regional no
 * período da guia — "TDs (REC)" —, sem valor digitado. As retenções seguem
 * as PPs de origem e o IOF do mútuo, a empresa que emprestou.
 */
import { Users } from "lucide-react";
import type { RateioDaGuia } from "@/lib/fiscal/apuracao";
import { pelaReceita } from "@/lib/fiscal/rateio-gerencial";
import { moeda, pct } from "./ui";

/** O critério do rateio, pelo imposto: o texto do título da caixa. */
export function criterioDoRateio(tributo: string, contabilidade = false): string {
  if (pelaReceita(tributo)) return "TDs (REC) · pela receita de cada regional no período";
  if (tributo === "IOF") return "a empresa que emprestou, como no cálculo do IOF do mútuo";
  return contabilidade ? "pela receita de cada regional no período" : "pelas PPs de origem";
}

export function RateioDaGuia({
  tributo,
  partes,
  vazio,
  contabilidade = false,
}: {
  tributo: string;
  /** As partes já levadas ao valor da guia. */
  partes: RateioDaGuia[];
  /** O texto quando não há como dividir. */
  vazio: string;
  /** Guia da contabilidade: a retenção também divide pela receita do período (não há PP de origem). */
  contabilidade?: boolean;
}) {
  const visiveis = partes.filter((p) => Math.abs(p.valor) >= 0.005);
  const soma = visiveis.reduce((s, p) => s + p.valor, 0);
  return (
    <div className="rounded-xl border border-border">
      <p className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <Users className="h-3.5 w-3.5 shrink-0" />
        {pelaReceita(tributo) ? (
          // "TDs (REC)" com a caixa que o Tiago escreve; o resto, no estilo dos títulos das caixas.
          <span>
            Rateio · <span className="normal-case">TDs (REC)</span> · pela receita de cada regional no período
          </span>
        ) : (
          <span>Rateio · {criterioDoRateio(tributo, contabilidade)}</span>
        )}
      </p>
      {visiveis.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-amber-800">{vazio}</p>
      ) : (
        <table className="w-full table-fixed text-[12.5px]">
          <colgroup>
            <col />
            <col className="w-[120px]" />
            <col className="w-[64px]" />
            <col className="w-[120px]" />
          </colgroup>
          <tbody>
            {visiveis.map((p) => (
              <tr key={`${p.empresa_id}|${p.regional_id ?? ""}`} className="border-b border-border/70 last:border-0">
                <td className="truncate px-3 py-1.5">{p.empresa_nome}</td>
                <td className="truncate px-3 py-1.5 text-muted-foreground">{p.regional_nome ?? "Sem regional"}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                  {pct(soma ? Math.round((p.valor / soma) * 10000) / 100 : 0)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{moeda(p.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
