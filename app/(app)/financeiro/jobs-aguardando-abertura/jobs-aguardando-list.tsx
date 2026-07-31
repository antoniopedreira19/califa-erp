"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AprovarDrawer } from "./aprovar-drawer";
import { RejeitarDrawer } from "./rejeitar-drawer";

export interface JobAguardandoRow {
  id: string;
  codigo: string;
  nome: string;
  valor_total: number | null;
  data_inicio_prevista: string | null;
  orcamento_id: string;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  regional_nome: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function JobsAguardandoList({ rows }: { rows: JobAguardandoRow[] }) {
  const router = useRouter();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-semibold">Código</th>
            <th className="px-4 py-3 font-semibold">Nome</th>
            <th className="px-4 py-3 font-semibold">Projeto</th>
            <th className="px-4 py-3 font-semibold">Cliente</th>
            <th className="px-4 py-3 font-semibold">Responsável</th>
            <th className="px-4 py-3 font-semibold">Início</th>
            <th className="px-4 py-3 font-semibold text-right">Valor</th>
            <th className="px-4 py-3 font-semibold text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/jobs/${r.id}?from=financeiro`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/jobs/${r.id}?from=financeiro`);
                }
              }}
              className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
            >
              <td className="px-4 py-3 font-mono text-xs">
                <Link
                  href={`/jobs/${r.id}?from=financeiro`}
                  prefetch={false}
                  className="hover:text-california-red"
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.codigo}
                </Link>
              </td>
              <td className="px-4 py-3 font-medium">{r.nome}</td>
              <td className="px-4 py-3 text-muted-foreground">
                <span className="font-mono text-xs">{r.projeto_codigo}</span>{" "}
                <span>{r.projeto_nome ?? ""}</span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{r.cliente_nome ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{r.responsavel_nome ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(r.data_inicio_prevista)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold">
                {formatMoney(r.valor_total)}
              </td>
              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                <div className="inline-flex items-center gap-2">
                  <AprovarDrawer jobId={r.id} jobCodigo={r.codigo} />
                  <RejeitarDrawer jobId={r.id} jobCodigo={r.codigo} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
