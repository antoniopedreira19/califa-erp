"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { type DesembolsoStatus, desembolsoStatusLabel } from "@/lib/types";
import { DesembolsoDrawer } from "./desembolso-drawer";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface DesembolsoRow {
  id: string;
  codigo: string;
  descricao: string;
  valor: string;
  status: DesembolsoStatus;
  data_prevista_pagamento: string | null;
  criado_por: string;
  created_at: string;
  empresa: { id: string; razao_social: string | null; nome_fantasia: string | null } | null;
  fornecedor: { id: string; nome: string; razao_social: string | null } | null;
  criador: { nome: string } | null;
}

interface Props {
  rows: DesembolsoRow[];
  tenantId: string;
  empresas: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean }>;
  isAdminOrFinanceiro: boolean;
}

// ---------------------------------------------------------------------------
// Chips de filtro
// ---------------------------------------------------------------------------

type StatusFiltro = "todos" | DesembolsoStatus;

const STATUS_FILTROS: Array<{ key: StatusFiltro; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "aprovada", label: "Aprovados" },
  { key: "pago", label: "Pagos" },
  { key: "rejeitada", label: "Rejeitados" },
  { key: "cancelada", label: "Cancelados" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(v: string | number): string {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function statusBadgeClass(s: DesembolsoStatus): string {
  switch (s) {
    case "em_avaliacao":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "aprovada":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "pago":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "rejeitada":
      return "border-california-red/20 bg-california-red/5 text-california-red";
    case "cancelada":
      return "border-border bg-muted/60 text-muted-foreground";
  }
}

function nomeEmpresa(
  empresa: DesembolsoRow["empresa"],
): string {
  if (!empresa) return "—";
  return empresa.razao_social ?? empresa.nome_fantasia ?? "—";
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function DesembolsosList({
  rows,
  tenantId,
  empresas,
  fornecedores,
  clientes,
  jobs,
  regionais,
  isAdminOrFinanceiro,
}: Props) {
  const router = useRouter();
  const [statusFiltro, setStatusFiltro] = React.useState<StatusFiltro>("todos");
  const [busca, setBusca] = React.useState("");
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFiltro !== "todos" && r.status !== statusFiltro) return false;
      if (!q) return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.descricao.toLowerCase().includes(q) ||
        (r.fornecedor?.nome ?? "").toLowerCase().includes(q) ||
        nomeEmpresa(r.empresa).toLowerCase().includes(q)
      );
    });
  }, [rows, statusFiltro, busca]);

  return (
    <div className="space-y-4">
      {/* Barra de filtros + busca + botão */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {STATUS_FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFiltro(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                statusFiltro === f.key
                  ? "border-california-red bg-california-red text-white"
                  : "border-border bg-white text-muted-foreground hover:border-california-red/50",
              )}
            >
              {f.label}
            </button>
          ))}

          <div className="relative ml-auto flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código, descrição ou fornecedor..."
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red/90 shrink-0"
        >
          <Plus className="h-4 w-4" />
          Novo Desembolso
        </button>
      </div>

      {/* Tabela ou empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhum desembolso lançado ainda. Clique em 'Novo Desembolso' para começar."
              : "Nenhum desembolso corresponde aos filtros aplicados."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Código / Descrição</th>
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-left">Fornecedor</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-left">Vencimento</th>
                <th className="px-3 py-2 text-left">Status</th>
                {isAdminOrFinanceiro && (
                  <th className="px-3 py-2 text-left">Criado por</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/financeiro/desembolsos/${r.id}`)}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/financeiro/desembolsos/${r.id}`}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs font-semibold text-california-red hover:underline"
                    >
                      {r.codigo}
                    </Link>
                    <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {r.descricao}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {nomeEmpresa(r.empresa)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.fornecedor
                      ? (r.fornecedor.razao_social ?? r.fornecedor.nome)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                    {formatMoney(r.valor)}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {formatDate(r.data_prevista_pagamento)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        statusBadgeClass(r.status),
                      )}
                    >
                      {desembolsoStatusLabel(r.status)}
                    </span>
                  </td>
                  {isAdminOrFinanceiro && (
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.criador?.nome ?? "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer de criação */}
      <DesembolsoDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        tenantId={tenantId}
        empresas={empresas}
        fornecedores={fornecedores}
        clientes={clientes}
        jobs={jobs}
        regionais={regionais}
      />
    </div>
  );
}
