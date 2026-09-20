"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export type CompetenciaResumo = {
  chave: string;
  ano: number;
  mes: number;
  nome: string;
  total: number;
  rascunho: number;
  enviada: number;
  aprovada: number;
  pendente_correcao: number;
  paga: number;
};

export function FolhasList({
  competencias,
}: {
  competencias: CompetenciaResumo[];
}) {
  const router = useRouter();

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Competência
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-20">
              Total
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
              Rascunho
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
              Enviada
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
              Pendente
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
              Aprovada
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-20">
              Paga
            </th>
          </tr>
        </thead>
        <tbody>
          {competencias.map((c) => (
            <tr
              key={c.chave}
              onClick={() =>
                router.push(
                  `/rh/folhas/${c.ano}-${String(c.mes).padStart(2, "0")}`,
                )
              }
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(
                    `/rh/folhas/${c.ano}-${String(c.mes).padStart(2, "0")}`,
                  );
                }
              }}
              className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
            >
              <td className="px-4 py-3 font-medium">{c.nome}</td>
              <td className="px-4 py-3 text-right tabular-nums">{c.total}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {c.rascunho > 0 ? c.rascunho : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {c.enviada > 0 ? c.enviada : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {c.pendente_correcao > 0 ? (
                  <span className="font-semibold text-california-red">
                    {c.pendente_correcao}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {c.aprovada > 0 ? c.aprovada : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {c.paga > 0 ? (
                  <span className="font-semibold text-emerald-600">
                    {c.paga}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
