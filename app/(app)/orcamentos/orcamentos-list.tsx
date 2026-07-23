"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  orcamentoStatusLabel,
  type Cliente,
  type OrcamentoStatus,
  type Profile,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface OrcamentoRow {
  id: string;
  codigo: string;
  nome: string;
  status: OrcamentoStatus;
  cliente_id: string;
  responsavel_id: string;
  tipo: string | null;
  campanha: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  created_at: string;
  cliente_nome: string | null;
  responsavel_nome: string | null;
}

const STATUS_ORDER: OrcamentoStatus[] = [
  "rascunho",
  "em_revisao",
  "enviado_cliente",
  "aprovado",
  "job_criado",
  "recusado",
  "cancelado",
];

function statusBadgeClasses(status: OrcamentoStatus): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviado_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "job_criado":
      return "bg-california-red/10 text-california-red border-california-red/20";
    case "recusado":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function OrcamentosList({
  orcamentos,
  clientes,
  responsaveis,
}: {
  orcamentos: OrcamentoRow[];
  clientes: Pick<Cliente, "id" | "nome_fantasia">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [statusFiltro, setStatusFiltro] = React.useState<OrcamentoStatus | "todos">("todos");
  const [clienteFiltro, setClienteFiltro] = React.useState<string>("todos");
  const [responsavelFiltro, setResponsavelFiltro] = React.useState<string>("todos");

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return orcamentos.filter((o) => {
      if (statusFiltro !== "todos" && o.status !== statusFiltro) return false;
      if (clienteFiltro !== "todos" && o.cliente_id !== clienteFiltro) return false;
      if (
        responsavelFiltro !== "todos" &&
        o.responsavel_id !== responsavelFiltro
      )
        return false;
      if (!q) return true;
      return (
        o.codigo.toLowerCase().includes(q) ||
        o.nome.toLowerCase().includes(q) ||
        (o.cliente_nome?.toLowerCase().includes(q) ?? false) ||
        (o.campanha?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [orcamentos, busca, statusFiltro, clienteFiltro, responsavelFiltro]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <div className="relative flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, nome, cliente ou campanha..."
            className="pl-10"
          />
        </div>

        <select
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value as OrcamentoStatus | "todos")}
          className="h-11 rounded-lg border border-border bg-white px-3 text-sm text-foreground hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15"
        >
          <option value="todos">Todos os status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {orcamentoStatusLabel(s)}
            </option>
          ))}
        </select>

        <select
          value={clienteFiltro}
          onChange={(e) => setClienteFiltro(e.target.value)}
          className="h-11 rounded-lg border border-border bg-white px-3 text-sm text-foreground hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15"
        >
          <option value="todos">Todos os clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome_fantasia}
            </option>
          ))}
        </select>

        <select
          value={responsavelFiltro}
          onChange={(e) => setResponsavelFiltro(e.target.value)}
          className="h-11 rounded-lg border border-border bg-white px-3 text-sm text-foreground hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15"
        >
          <option value="todos">Todos os responsáveis</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} de {orcamentos.length}
        </span>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nenhum orçamento com esses filtros.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((o) => {
              const href = `/orcamentos/${o.id}`;
              return (
              <TableRow
                key={o.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50"
              >
                <TableCell>
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono text-xs font-semibold text-foreground hover:text-california-red transition-colors"
                  >
                    {o.codigo}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="font-medium text-foreground">{o.nome}</span>
                  {o.campanha && (
                    <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                      {o.campanha}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {o.cliente_nome ?? "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {o.responsavel_nome ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {o.data_inicio_prevista || o.data_fim_prevista ? (
                    <>
                      {formatDate(o.data_inicio_prevista)}
                      <span className="mx-1">→</span>
                      {formatDate(o.data_fim_prevista)}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={cn("border", statusBadgeClasses(o.status))}>
                    {orcamentoStatusLabel(o.status)}
                  </Badge>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
