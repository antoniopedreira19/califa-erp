"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ContaAvulsaStatus,
  PlanoContaTipo,
  PlanoContaSubtipo,
  NaturezaLancamento,
} from "@/lib/types";
import { contaAvulsaStatusLabel } from "@/lib/types";
import { ContaAvulsaDrawer } from "./conta-avulsa-drawer";

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export interface AvulsaRow {
  id: string;
  descricao: string;
  valor: number;
  natureza: NaturezaLancamento;
  data_prevista_pagamento: string | null;
  status: ContaAvulsaStatus;
  fornecedor_nome: string | null;
  cliente_nome: string | null;
  job_codigo: string | null;
  empresa_nome: string;
  tipo_codigo: string;
  subtipo_nome: string;
  anexos_count: number;
  pago_em: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constantes de filtros
// ---------------------------------------------------------------------------

const STATUS_FILTROS: Array<{ key: "todas" | ContaAvulsaStatus; label: string }> = [
  { key: "aprovada", label: "Aprovadas" },
  { key: "baixada", label: "Baixadas" },
  { key: "todas", label: "Todas" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeClass(status: ContaAvulsaStatus): string {
  return status === "aprovada"
    ? "bg-[#fffbeb] text-[#92400e] border-[#fde68a]"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Props do componente
// ---------------------------------------------------------------------------

interface Props {
  rows: AvulsaRow[];
  tenantId: string;
  empresas: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  fornecedores: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string; cliente_id: string | null; regional_id: string | null }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean }>;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function ContasAvulsasList({
  rows,
  tenantId,
  empresas,
  tipos,
  subtipos,
  fornecedores,
  clientes,
  jobs,
  regionais,
}: Props) {
  const [busca, setBusca] = React.useState("");
  const [statusFiltro, setStatusFiltro] = React.useState<"todas" | ContaAvulsaStatus>("aprovada");

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFiltro !== "todas" && r.status !== statusFiltro) return false;
      if (!q) return true;
      return (
        r.descricao.toLowerCase().includes(q) ||
        (r.fornecedor_nome ?? "").toLowerCase().includes(q) ||
        (r.cliente_nome ?? "").toLowerCase().includes(q) ||
        (r.job_codigo ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, busca, statusFiltro]);

  return (
    <div className="space-y-4">
      {/* Barra de filtros + busca + botão nova conta */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Chips de status */}
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

          {/* Campo de busca */}
          <div className="relative ml-auto flex-1 min-w-[240px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por descrição, fornecedor, cliente ou job..."
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            />
          </div>
        </div>

        {/* Botão nova conta avulsa */}
        <ContaAvulsaDrawer
          mode="criar"
          tenantId={tenantId}
          empresas={empresas}
          tipos={tipos}
          subtipos={subtipos}
          fornecedores={fornecedores}
          clientes={clientes}
          jobs={jobs}
          regionais={regionais}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover"
            >
              <Plus className="h-4 w-4" />
              Nova conta avulsa
            </button>
          }
        />
      </div>

      {/* Tabela ou empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhuma conta avulsa cadastrada ainda."
              : "Nenhuma conta corresponde aos filtros aplicados."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data Prevista</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-left">Fornecedor/Cliente</th>
                <th className="px-3 py-2 text-left">Job</th>
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-center">Anexos</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2 text-xs font-mono">
                    {formatDate(r.data_prevista_pagamento)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/financeiro/contas-a-pagar/avulsa/${r.id}`}
                      prefetch={false}
                      className="text-california-red hover:underline"
                    >
                      {r.descricao}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.fornecedor_nome ?? r.cliente_nome ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {r.job_codigo ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.empresa_nome}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="font-mono">{r.tipo_codigo}</span>
                    {r.subtipo_nome ? ` · ${r.subtipo_nome}` : ""}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono text-xs font-semibold",
                      r.natureza === "entrada"
                        ? "text-emerald-700"
                        : "text-california-red",
                    )}
                  >
                    {formatMoney(r.valor)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        statusBadgeClass(r.status),
                      )}
                    >
                      {contaAvulsaStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.anexos_count > 0 ? r.anexos_count : "—"}
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
