"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export type StatusAgregado = "rascunho" | "enviada" | "concluida";

export type CompetenciaResumo = {
  chave: string;
  ano: number;
  mes: number;
  nome: string;
  colaboradores: number;
  totalValor: number;
  statusAgregado: StatusAgregado;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

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
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-32">
              Colaboradores
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-40">
              Total
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-36">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {competencias.map((c) => {
            const href = `/rh/folhas/${c.ano}-${String(c.mes).padStart(2, "0")}`;
            return (
              <tr
                key={c.chave}
                onClick={() => router.push(href)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3 font-medium">{c.nome}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {c.colaboradores}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {brl.format(c.totalValor)}
                </td>
                <td className="px-4 py-3">
                  <BadgeStatusAgregado status={c.statusAgregado} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BadgeStatusAgregado({ status }: { status: StatusAgregado }) {
  const label =
    status === "rascunho"
      ? "Rascunho"
      : status === "enviada"
        ? "Enviada"
        : "Concluída";
  const cor =
    status === "rascunho"
      ? "bg-muted text-muted-foreground"
      : status === "enviada"
        ? "bg-blue-50 text-blue-700"
        : "bg-emerald-600 text-white";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cor}`}
    >
      {label}
    </span>
  );
}
