"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { jobStatusLabel, type JobStatus } from "@/lib/types";

export interface JobRow {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
  valor_total: number | null;
  data_inicio_prevista: string | null;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  is_sub_job: boolean;
  tem_filhos: boolean;
}

const STATUS_FILTROS: JobStatus[] = [
  "aguardando_abertura",
  "rejeitado_financeiro",
  "aberto",
  "em_producao",
  "finalizado",
  "cancelado",
];

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "finalizado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
    case "aguardando_abertura":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "rejeitado_financeiro":
      return "bg-red-50 text-red-700 border-red-200";
  }
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

export function JobsList({ rows }: { rows: JobRow[] }) {
  const router = useRouter();
  const [statusAtivos, setStatusAtivos] = React.useState<Set<JobStatus>>(
    new Set(),
  );
  const [busca, setBusca] = React.useState("");

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusAtivos.size > 0 && !statusAtivos.has(r.status)) return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.nome.toLowerCase().includes(q)
      );
    });
  }, [rows, statusAtivos, busca]);

  function toggleStatus(s: JobStatus) {
    setStatusAtivos((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Chips de filtro + busca */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTROS.map((s) => {
            const ativo = statusAtivos.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  ativo
                    ? "bg-california-red text-white border-california-red"
                    : "bg-white text-muted-foreground border-border hover:border-california-red/40 hover:text-california-red",
                )}
              >
                {jobStatusLabel(s)}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou codigo"
            className="rounded-lg border border-border bg-white pl-8 pr-3 py-1.5 text-xs w-64 focus:outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Codigo</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Projeto</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Responsavel</th>
              <th className="px-4 py-3 font-semibold">Inicio</th>
              <th className="px-4 py-3 font-semibold text-right">Valor total</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "Nenhum job criado ainda. Aprove uma versao de orcamento e crie um job."
                    : "Nenhum job encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {filtrados.map((r) => (
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/jobs/${r.id}?from=jobs`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/jobs/${r.id}?from=jobs`);
                  }
                }}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
              >
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/jobs/${r.id}?from=jobs`}
                    prefetch={false}
                    className="hover:text-california-red"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.codigo}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.nome}</span>
                    {r.tem_filhos && (
                      <Badge variant="neutral" className="text-[10px]">
                        Job principal
                      </Badge>
                    )}
                    {r.is_sub_job && (
                      <Badge variant="neutral" className="text-[10px]">
                        Sub-job
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="font-mono text-xs">{r.projeto_codigo}</span>{" "}
                  <span>{r.projeto_nome ?? ""}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.cliente_nome ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.responsavel_nome ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(r.data_inicio_prevista)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {formatMoney(r.valor_total)}
                </td>
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(r.status))}>
                    {jobStatusLabel(r.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
