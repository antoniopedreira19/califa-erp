"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { jobStatusLabel, type JobStatus } from "@/lib/types";

export interface JobRow {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
  valor_total: number | null;
  data_inicio_prevista: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
}

const STATUS_FILTROS: JobStatus[] = [
  "aguardando_abertura",
  "rejeitado_financeiro",
  "aberto",
  "encerrado",
  "cancelado",
];

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "encerrado":
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

type DisplayRow =
  | {
      kind: "projeto";
      projeto_id: string;
      projeto_codigo: string | null;
      projeto_nome: string | null;
      cliente_nome: string | null;
      quantidadeJobs: number;
      valorTotalGrupo: number;
      expanded: boolean;
    }
  | {
      kind: "job";
      row: JobRow;
      indentado: boolean;
    };

export function JobsList({
  rows,
  empresas,
}: {
  rows: JobRow[];
  empresas: { id: string; razao_social: string; nome_fantasia: string | null }[];
}) {
  const router = useRouter();
  const [statusAtivos, setStatusAtivos] = React.useState<Set<JobStatus>>(
    new Set(),
  );
  const [busca, setBusca] = React.useState("");
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [empresaFiltro, setEmpresaFiltro] = React.useState<string>("todas");

  const gruposPorProjeto = React.useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const r of rows) {
      const arr = map.get(r.projeto_id) ?? [];
      arr.push(r);
      map.set(r.projeto_id, arr);
    }
    return map;
  }, [rows]);

  const displayRows = React.useMemo<DisplayRow[]>(() => {
    const q = busca.trim().toLowerCase();
    const filterActive =
      statusAtivos.size > 0 || q !== "" || empresaFiltro !== "todas";

    function matches(r: JobRow): boolean {
      if (statusAtivos.size > 0 && !statusAtivos.has(r.status)) return false;
      if (empresaFiltro !== "todas" && r.empresa_id !== empresaFiltro)
        return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.nome.toLowerCase().includes(q)
      );
    }

    // Ordena projetos pelo menor codigo de job dentro do grupo
    const projetosOrdenados = Array.from(gruposPorProjeto.entries())
      .map(([projetoId, jobsDoGrupo]) => {
        const ordenados = [...jobsDoGrupo].sort((a, b) =>
          a.codigo.localeCompare(b.codigo),
        );
        return { projetoId, jobs: ordenados };
      })
      .sort((a, b) => a.jobs[0].codigo.localeCompare(b.jobs[0].codigo));

    const out: DisplayRow[] = [];

    for (const { projetoId, jobs } of projetosOrdenados) {
      const jobsFiltrados = jobs.filter(matches);
      if (jobsFiltrados.length === 0) continue;

      // Caso 1: projeto original tem 1 job -> linha direta, sem header
      if (jobs.length === 1) {
        out.push({ kind: "job", row: jobsFiltrados[0], indentado: false });
        continue;
      }

      // Caso 2: projeto tem 2+ jobs -> header de projeto + jobs indentados
      const primeiro = jobs[0];
      const expanded = filterActive ? true : expandedIds.has(projetoId);

      out.push({
        kind: "projeto",
        projeto_id: projetoId,
        projeto_codigo: primeiro.projeto_codigo,
        projeto_nome: primeiro.projeto_nome,
        cliente_nome: primeiro.cliente_nome,
        quantidadeJobs: jobsFiltrados.length,
        valorTotalGrupo: jobsFiltrados.reduce(
          (s, j) => s + (j.valor_total ?? 0),
          0,
        ),
        expanded,
      });

      if (expanded) {
        for (const j of jobsFiltrados) {
          out.push({ kind: "job", row: j, indentado: true });
        }
      }
    }

    return out;
  }, [gruposPorProjeto, statusAtivos, busca, empresaFiltro, expandedIds]);

  function toggleStatus(s: JobStatus) {
    setStatusAtivos((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
        <div className="flex items-center gap-2">
          {empresas.length > 0 && (
            <Select value={empresaFiltro} onValueChange={setEmpresaFiltro}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                side="bottom"
                avoidCollisions={false}
                className="w-[--radix-select-trigger-width]"
              >
                <SelectItem value="todas">Todas as empresas</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome_fantasia ?? e.razao_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-8 px-2 py-3" aria-label="Expandir" />
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Empresa</th>
              <th className="px-4 py-3 font-semibold">Projeto</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Responsável</th>
              <th className="px-4 py-3 font-semibold">Início</th>
              <th className="px-4 py-3 font-semibold text-right">Valor total</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "Nenhum job criado ainda. Aprove uma versão de orçamento e crie um job."
                    : "Nenhum job encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {displayRows.map((dr) => {
              if (dr.kind === "projeto") {
                return (
                  <tr
                    key={`p-${dr.projeto_id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/jobs/projeto/${dr.projeto_id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/jobs/projeto/${dr.projeto_id}`);
                      }
                    }}
                    className="border-b border-border bg-california-red/5 hover:bg-california-red/10 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-california-red/10"
                  >
                    <td className="w-8 px-2 py-3 align-middle border-l-4 border-l-california-red">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(dr.projeto_id);
                        }}
                        aria-label={dr.expanded ? "Colapsar jobs do projeto" : "Expandir jobs do projeto"}
                        aria-expanded={dr.expanded}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {dr.expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {dr.projeto_codigo ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{dr.projeto_nome ?? "Projeto"}</span>
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {dr.quantidadeJobs} jobs
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {dr.cliente_nome ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {formatMoney(dr.valorTotalGrupo)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                  </tr>
                );
              }

              const r = dr.row;
              const isChild = dr.indentado;
              return (
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
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40",
                    isChild && "bg-california-red/[0.03] hover:bg-california-red/10",
                  )}
                >
                  <td
                    className={cn(
                      "w-8 px-2 py-3 align-middle",
                      isChild && "border-l-4 border-l-california-red",
                    )}
                  />
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
                  <td className={cn("px-4 py-3", isChild && "pl-8")}>
                    <div className="flex flex-wrap items-center gap-2">
                      {isChild && (
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground/60"
                        >
                          └
                        </span>
                      )}
                      <span className="font-medium">{r.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.empresa_nome ? (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {r.empresa_nome}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
