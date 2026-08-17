"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  estagioFunilBadgeClasses,
  estagioFunilLabel,
  type EstagioFunil,
} from "@/lib/calculos/funil";

export interface OrcamentoRow {
  id: string;
  codigo: string;
  nome: string;
  categoria_nome: string | null;
  /** Estágio do funil comercial (lib/calculos/funil.ts) — a mesma
   *  semântica que a lista de projetos usa pra contar. */
  estagio: EstagioFunil;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  /** Valor do job da versão aprovada (ou da mais recente, em negociação).
   *  `null` quando o orçamento ainda não tem versão. */
  valor_job: number | null;
  versoes_count: number;
  created_at: string;
}

interface Props {
  projetoId: string;
  orcamentos: OrcamentoRow[];
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
            <th className="px-4 py-3 font-semibold text-right">Valor do Job</th>
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
              <td className="px-4 py-3 text-right tabular-nums">
                {o.valor_job === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatBRL(o.valor_job)
                )}
              </td>
              <td className="px-4 py-3 text-center tabular-nums">{o.versoes_count}</td>
              <td className="px-4 py-3">
                <Badge className={cn("border", estagioFunilBadgeClasses(o.estagio))}>
                  {estagioFunilLabel(o.estagio)}
                </Badge>
              </td>
            </tr>
          ))}
          {orcamentos.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nenhum orçamento neste projeto ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
