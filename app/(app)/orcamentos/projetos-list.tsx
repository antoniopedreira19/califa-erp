"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Briefcase, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Cliente, Profile, ProjetoStatus } from "@/lib/types";
import { projetoStatusLabel } from "@/lib/types";

export interface ProjetoRow {
  id: string;
  codigo: string;
  nome: string;
  campanha: string | null;
  categoria_nome: string | null;
  status: ProjetoStatus;
  cliente_id: string;
  cliente_nome: string | null;
  responsavel_id: string;
  responsavel_nome: string | null;
  data_inicio_prevista: string;
  orcamentos_count: number;
  /** Orçamentos com status aprovado OU job_criado. */
  aprovados_count: number;
  /** Orçamentos com status job_criado (subset de aprovados). */
  jobs_count: number;
  created_at: string;
}

interface Props {
  projetos: ProjetoRow[];
  clientes: Pick<Cliente, "id" | "nome_fantasia">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}

function statusBadgeClasses(status: ProjetoStatus): string {
  return status === "ativo"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function ProjetosList({ projetos, clientes, responsaveis }: Props) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [clienteFiltro, setClienteFiltro] = React.useState<string>("todos");
  const [respFiltro, setRespFiltro] = React.useState<string>("todos");
  const [statusFiltro, setStatusFiltro] = React.useState<string>("ativos");

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return projetos.filter((p) => {
      if (clienteFiltro !== "todos" && p.cliente_id !== clienteFiltro) return false;
      if (respFiltro !== "todos" && p.responsavel_id !== respFiltro) return false;
      if (statusFiltro === "ativos" && p.status !== "ativo") return false;
      if (statusFiltro === "arquivados" && p.status !== "arquivado") return false;
      if (q) {
        const hay = `${p.codigo} ${p.nome} ${p.campanha ?? ""} ${p.cliente_nome ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projetos, busca, clienteFiltro, respFiltro, statusFiltro]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, nome, campanha ou cliente..."
            className="pl-9"
          />
        </div>
        <Select value={clienteFiltro} onValueChange={setClienteFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os clientes</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nome_fantasia}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={respFiltro} onValueChange={setRespFiltro}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os criadores</SelectItem>
            {responsaveis.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="arquivados">Arquivados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Criado por</th>
              <th className="px-4 py-3 font-semibold">Categoria</th>
              <th className="px-4 py-3 font-semibold">Início</th>
              <th className="px-4 py-3 font-semibold text-center">Orçamentos</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => (
              <tr
                key={p.id}
                role="button"
                tabIndex={0}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
                onClick={() => router.push(`/orcamentos/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/orcamentos/${p.id}`);
                  }
                }}
              >
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/orcamentos/${p.id}`}
                    prefetch={false}
                    className="hover:text-california-red"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.codigo}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{p.nome}</span>
                    {p.aprovados_count > 0 && (
                      <span
                        title={`${p.aprovados_count} de ${p.orcamentos_count} orçamento(s) aprovado(s)`}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        {p.aprovados_count} aprovado{p.aprovados_count > 1 ? "s" : ""}
                      </span>
                    )}
                    {p.jobs_count > 0 && (
                      <span
                        title={`${p.jobs_count} job(s) criado(s) a partir deste projeto`}
                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
                      >
                        <Briefcase className="h-3 w-3" />
                        {p.jobs_count} job{p.jobs_count > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{p.cliente_nome ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.responsavel_nome ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.categoria_nome ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.data_inicio_prevista)}</td>
                <td className="px-4 py-3 text-center tabular-nums">{p.orcamentos_count}</td>
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(p.status))}>
                    {projetoStatusLabel(p.status)}
                  </Badge>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhum projeto encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
