"use client";

import Link from "next/link";
import type { ContaAvulsaStatus } from "@/lib/types";
import { contaAvulsaStatusLabel } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Ocorrencia {
  id: string;
  data_prevista_pagamento: string | null;
  status: ContaAvulsaStatus;
  valor: number;
  pago_em: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusBadge(status: ContaAvulsaStatus): string {
  return status === "aprovada"
    ? "bg-[#fffbeb] text-[#92400e] border-[#fde68a]"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
}

export function HistoricoOcorrencias({ ocorrencias }: { ocorrencias: Ocorrencia[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
        Ocorrências geradas
      </h2>
      {ocorrencias.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma ocorrência gerada até agora. A próxima entra na data prevista.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data prevista</th>
                <th className="px-3 py-2 text-left">Data pagamento</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {ocorrencias.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{formatDate(o.data_prevista_pagamento)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatDate(o.pago_em)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        statusBadge(o.status),
                      )}
                    >
                      {contaAvulsaStatusLabel(o.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{formatMoney(o.valor)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/financeiro/contas-a-pagar/avulsa/${o.id}`}
                      prefetch={false}
                      className="text-california-red hover:underline text-xs"
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
