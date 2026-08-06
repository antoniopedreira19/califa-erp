"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { orcamentoStatusLabel, type Orcamento } from "@/lib/types";

export interface OrcamentoRow {
  id: string;
  codigo: string;
  nome: string;
  categoria_nome: string | null;
  status: Orcamento["status"];
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  versoes_count: number;
  created_at: string;
}

interface Props {
  projetoId: string;
  orcamentos: OrcamentoRow[];
}

function statusBadgeClasses(status: Orcamento["status"]): string {
  switch (status) {
    case "rascunho": return "bg-muted text-muted-foreground border-border";
    case "em_revisao": return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviado_cliente": return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovado": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "job_criado": return "bg-california-red/10 text-california-red border-california-red/20";
    case "recusado": return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelado": return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function OrcamentosList({ projetoId, orcamentos }: Props) {
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-semibold">Código</th>
            <th className="px-4 py-3 font-semibold">Nome</th>
            <th className="px-4 py-3 font-semibold">Categoria</th>
            <th className="px-4 py-3 font-semibold">Início previsto</th>
            <th className="px-4 py-3 font-semibold">Fim previsto</th>
            <th className="px-4 py-3 font-semibold text-center">Versões</th>
            <th className="px-4 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {orcamentos.map((o) => (
            <tr
              key={o.id}
              role="button"
              tabIndex={0}
              className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
              onClick={() => router.push(`/orcamentos/${projetoId}/${o.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/orcamentos/${projetoId}/${o.id}`);
                }
              }}
            >
              <td className="px-4 py-3 font-mono text-xs">
                <Link
                  href={`/orcamentos/${projetoId}/${o.id}`}
                  prefetch={false}
                  className="hover:text-california-red"
                  onClick={(e) => e.stopPropagation()}
                >
                  {o.codigo}
                </Link>
              </td>
              <td className="px-4 py-3 font-medium">{o.nome}</td>
              <td className="px-4 py-3 text-muted-foreground">{o.categoria_nome ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(o.data_inicio_prevista)}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(o.data_fim_prevista)}</td>
              <td className="px-4 py-3 text-center tabular-nums">{o.versoes_count}</td>
              <td className="px-4 py-3">
                <Badge className={cn("border", statusBadgeClasses(o.status))}>
                  {orcamentoStatusLabel(o.status)}
                </Badge>
              </td>
            </tr>
          ))}
          {orcamentos.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nenhum orçamento neste projeto ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
