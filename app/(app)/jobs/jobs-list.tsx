"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
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
  faturamento_previsto: number | null;
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

interface GrupoProjeto {
  projetoId: string;
  codigo: string | null;
  nome: string | null;
  cliente: string | null;
  jobs: JobRow[];
  total: number;
  totalFaturamento: number;
  aberto: boolean;
}

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
  // Grupos nascem abertos, como no design. Guardamos os FECHADOS pra não
  // precisar semear o state com os ids dos projetos no mount.
  const [fechadosIds, setFechadosIds] = React.useState<Set<string>>(new Set());
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

  const grupos = React.useMemo<GrupoProjeto[]>(() => {
    const q = busca.trim().toLowerCase();
    const filtroAtivo =
      statusAtivos.size > 0 || q !== "" || empresaFiltro !== "todas";

    function combina(r: JobRow): boolean {
      if (statusAtivos.size > 0 && !statusAtivos.has(r.status)) return false;
      if (empresaFiltro !== "todas" && r.empresa_id !== empresaFiltro)
        return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) || r.nome.toLowerCase().includes(q)
      );
    }

    // Projetos ordenados pelo menor código de job do grupo.
    const ordenados = Array.from(gruposPorProjeto.entries())
      .map(([projetoId, jobsDoGrupo]) => ({
        projetoId,
        jobs: [...jobsDoGrupo].sort((a, b) => a.codigo.localeCompare(b.codigo)),
      }))
      .sort((a, b) => a.jobs[0].codigo.localeCompare(b.jobs[0].codigo));

    const out: GrupoProjeto[] = [];

    for (const { projetoId, jobs } of ordenados) {
      const visiveis = jobs.filter(combina);
      if (visiveis.length === 0) continue;

      const primeiro = jobs[0];
      out.push({
        projetoId,
        codigo: primeiro.projeto_codigo,
        nome: primeiro.projeto_nome,
        cliente: primeiro.cliente_nome,
        jobs: visiveis,
        total: visiveis.reduce((s, j) => s + (j.valor_total ?? 0), 0),
        totalFaturamento: visiveis.reduce(
          (s, j) => s + (j.faturamento_previsto ?? 0),
          0,
        ),
        // Com filtro ativo o grupo abre sempre: fechado ele esconderia
        // justamente o job que o filtro encontrou.
        aberto: filtroAtivo ? true : !fechadosIds.has(projetoId),
      });
    }

    return out;
  }, [gruposPorProjeto, statusAtivos, busca, empresaFiltro, fechadosIds]);

  function toggleStatus(s: JobStatus) {
    setStatusAtivos((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function toggleGrupo(id: string) {
    setFechadosIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Chips de filtro + empresa + busca */}
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
                  "rounded-full border px-[13px] py-[5px] text-xs font-semibold transition-colors",
                  ativo
                    ? "border-california-red bg-california-red text-white"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/40 hover:text-california-red",
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
              <SelectTrigger className="h-9 w-[180px] px-2.5 text-[13px]">
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
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou código"
              className="w-64 rounded-lg border border-border bg-white py-2 pl-[30px] pr-3 text-xs text-foreground outline-none focus:border-california-red/40"
            />
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <th className="w-8 px-2 py-3" aria-label="Expandir" />
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Empresa</th>
              <th className="px-4 py-3 font-semibold">Projeto</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Responsável</th>
              <th className="px-4 py-3 font-semibold">Início</th>
              <th className="px-4 py-3 text-right font-semibold">
                Faturamento previsto
              </th>
              <th className="px-4 py-3 text-right font-semibold">Valor total</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <React.Fragment key={g.projetoId}>
                <tr
                  role="button"
                  tabIndex={0}
                  aria-expanded={g.aberto}
                  onClick={() => toggleGrupo(g.projetoId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleGrupo(g.projetoId);
                    }
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors hover:bg-[#f0eeee]/85 focus-visible:outline-none focus-visible:bg-[#f0eeee]/85",
                    g.aberto ? "bg-muted/90" : "bg-muted/40",
                  )}
                >
                  <td colSpan={11} className="p-0">
                    <div className="grid grid-cols-[32px_1fr_auto_auto_auto] items-center gap-4 py-[11px] pl-2 pr-4">
                      <div className="flex items-center justify-center">
                        <span
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-transform duration-150",
                            g.aberto && "rotate-90",
                          )}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <span className="font-mono text-xs font-semibold text-[#b3323c]">
                          {g.codigo ?? "—"}
                        </span>
                        <span className="text-[13.5px] font-semibold">
                          {g.nome ?? "Projeto"}
                        </span>
                        <span className="h-3 w-px bg-[#dcdcdc]" />
                        <span className="text-xs text-muted-foreground">
                          {g.cliente ?? "—"}
                        </span>
                      </div>
                      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                        {g.jobs.length === 1 ? "1 job" : `${g.jobs.length} jobs`}
                      </span>
                      {/* Faturamento previsto do projeto em cinza, valor do
                          job em preto — mesma hierarquia do card de Totais. */}
                      <span className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">
                        {formatMoney(g.totalFaturamento)}
                      </span>
                      <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">
                        {formatMoney(g.total)}
                      </span>
                      <Link
                        href={`/jobs/projeto/${g.projetoId}`}
                        prefetch={false}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-california-red hover:text-california-red/80"
                      >
                        Visão agregada
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </td>
                </tr>

                {g.aberto &&
                  g.jobs.map((j, i) => (
                    <tr
                      key={j.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/jobs/${j.id}?from=jobs`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/jobs/${j.id}?from=jobs`);
                        }
                      }}
                      className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:bg-muted/70"
                    >
                      {/* Calha da árvore: vertical desce até o meio da última
                          linha, e o traço horizontal encosta no código. */}
                      <td className="relative w-8 px-2 py-3">
                        <span
                          aria-hidden="true"
                          className="absolute left-[23px] top-0 w-px bg-[#dad7d7]"
                          style={{
                            height: i === g.jobs.length - 1 ? "50%" : "100%",
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="absolute left-6 top-1/2 h-px w-[9px] bg-[#dad7d7]"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link
                          href={`/jobs/${j.id}?from=jobs`}
                          prefetch={false}
                          className="text-california-red hover:text-california-red/80"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {j.codigo}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">{j.nome}</td>
                      <td className="px-4 py-3">
                        {j.empresa_nome ? (
                          <span className="inline-flex items-center rounded-full border border-border bg-muted/80 px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                            {j.empresa_nome}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="font-mono text-xs">
                          {j.projeto_codigo}
                        </span>{" "}
                        <span>{j.projeto_nome ?? ""}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {j.cliente_nome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {j.responsavel_nome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(j.data_inicio_prevista)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatMoney(j.faturamento_previsto)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(j.valor_total)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={cn("border", statusBadgeClasses(j.status))}
                        >
                          {jobStatusLabel(j.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {grupos.length === 0 && (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Nenhum job encontrado com esses filtros.
          </p>
        )}
      </div>
    </div>
  );
}
