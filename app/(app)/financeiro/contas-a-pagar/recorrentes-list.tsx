"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  FrequenciaRecorrencia,
  PlanoContaTipo,
  PlanoContaSubtipo,
} from "@/lib/types";
import { ContaRecorrenteDrawer } from "./conta-recorrente-drawer";

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export interface RecorrenteRow {
  id: string;
  descricao: string;
  valor: number;
  frequencia: FrequenciaRecorrencia;
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  proxima_data: string;
  data_fim: string | null;
  ativo: boolean;
  fornecedor_nome: string | null;
  empresa_nome: string;
  tipo_codigo: string;
  subtipo_nome: string;
}

// ---------------------------------------------------------------------------
// Constantes de filtros
// ---------------------------------------------------------------------------

type AtivoFiltro = "ativas" | "paradas" | "todas";

const ATIVO_FILTROS: Array<{ key: AtivoFiltro; label: string }> = [
  { key: "ativas", label: "Ativas" },
  { key: "paradas", label: "Paradas" },
  { key: "todas", label: "Todas" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MESES_ABR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function formatFrequenciaResumo(r: RecorrenteRow): string {
  if (r.frequencia === "mensal") return `Mensal · dia ${r.dia_do_mes}`;
  if (r.frequencia === "quinzenal")
    return `Quinzenal · ${r.dia_quinzena_1} e ${r.dia_quinzena_2}`;
  return `Anual · ${r.dia_do_ano_dia}/${MESES_ABR[(r.dia_do_ano_mes ?? 1) - 1]}`;
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
  rows: RecorrenteRow[];
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

export function RecorrentesList({
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
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [ativoFiltro, setAtivoFiltro] = React.useState<AtivoFiltro>("ativas");

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (ativoFiltro === "ativas" && !r.ativo) return false;
      if (ativoFiltro === "paradas" && r.ativo) return false;
      if (!q) return true;
      return (
        r.descricao.toLowerCase().includes(q) ||
        (r.fornecedor_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, busca, ativoFiltro]);

  return (
    <div className="space-y-4">
      {/* Barra de filtros + busca + botão nova recorrência */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Chips de status */}
          {ATIVO_FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setAtivoFiltro(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                ativoFiltro === f.key
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
              placeholder="Buscar por descrição ou fornecedor..."
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            />
          </div>
        </div>

        {/* Botão nova recorrência */}
        <ContaRecorrenteDrawer
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
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Nova recorrência
            </button>
          }
        />
      </div>

      {/* Tabela ou empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhuma recorrência cadastrada ainda."
              : "Nenhuma recorrência corresponde aos filtros aplicados."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-left">Frequência</th>
                <th className="px-3 py-2 text-left">Próxima data</th>
                <th className="px-3 py-2 text-left">Fornecedor</th>
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/financeiro/contas-a-pagar/recorrente/${r.id}`)}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                >
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/financeiro/contas-a-pagar/recorrente/${r.id}`}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-california-red hover:underline"
                    >
                      {r.descricao}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {formatFrequenciaResumo(r)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {formatDate(r.proxima_data)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.fornecedor_nome ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.empresa_nome}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                    {formatMoney(r.valor)}
                  </td>
                  <td className="px-3 py-2">
                    {r.ativo ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                        Ativa
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        Parada
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/financeiro/contas-a-pagar/recorrente/${r.id}`}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-muted-foreground hover:text-california-red hover:underline"
                    >
                      Ver detalhes
                    </Link>
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
