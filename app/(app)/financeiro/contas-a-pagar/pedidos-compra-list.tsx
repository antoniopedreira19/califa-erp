"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PPStatus } from "@/lib/types";
import { ppStatusLabel } from "@/lib/types";
import { PPDrawerFinanceiro } from "./pp-drawer-financeiro";

export interface PPRow {
  id: string;
  codigo: string;
  status: PPStatus;
  valor: number;
  prazo_pagamento: string;
  prazo_pagamento_financeiro: string | null;
  created_at: string;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  rejeitada_em: string | null;
  motivo_rejeicao: string | null;
  rejeitada_por_nome: string | null;
  pago_em: string | null;
  pago_por_nome: string | null;
  fornecedor_id: string;
  fornecedor_nome: string;
  empresa_id: string;
  empresa_nome: string;
  job_id: string;
  job_codigo: string;
  job_nome: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  servico: string;
  quantidade: number;
  especificacoes: string | null;
  pdf_path: string;
  cancelada_por_nome: string | null;
  emitida_por_nome: string | null;
  anexos: Array<{
    id: string;
    arquivo_nome_original: string;
    arquivo_tamanho_bytes: number;
  }>;
  /**
   * Parcelas da PP, sempre ao menos uma (1/1). Aqui são leitura — o
   * financeiro precisa ver em quantas vezes vai pagar ANTES de aprovar.
   * A baixa de cada uma acontece na aba "Títulos a Pagar" (Tela 3.2).
   */
  parcelas: Array<{
    id: string;
    numero: number;
    /** Prazo negociado pela produção. Não muda depois da emissão. */
    data_vencimento: string;
    /** Definida na aprovação; nula enquanto a PP está em avaliação. */
    data_pagamento: string | null;
    data_pagamento_primeira: string | null;
    valor: number;
    pago_em: string | null;
  }>;
}

function statusBadgeClasses(status: PPStatus): string {
  switch (status) {
    case "em_avaliacao":
      return "bg-[#fffbeb] text-[#92400e] border-[#fde68a]";
    case "aprovada":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "pago":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "rejeitada":
      return "bg-red-50 text-red-700 border-red-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type FiltroStatus = PPStatus | "todas";

const STATUS_FILTROS: Array<{ key: FiltroStatus; label: string }> = [
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "aprovada", label: "Aprovadas" },
  { key: "pago", label: "Pagas" },
  { key: "rejeitada", label: "Rejeitadas" },
  { key: "cancelada", label: "Canceladas" },
  { key: "todas", label: "Todas" },
];

interface PedidosCompraListProps {
  rows: PPRow[];
}

export function PedidosCompraList({ rows }: PedidosCompraListProps) {
  const [filtro, setFiltro] = React.useState<FiltroStatus>("em_avaliacao");
  const [busca, setBusca] = React.useState("");
  const [ppSelecionada, setPpSelecionada] = React.useState<PPRow | null>(null);

  const contagens = React.useMemo(() => {
    const c: Record<FiltroStatus, number> = {
      todas: rows.length,
      em_avaliacao: 0,
      aprovada: 0,
      pago: 0,
      rejeitada: 0,
      cancelada: 0,
    };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro !== "todas" && r.status !== filtro) return false;
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.fornecedor_nome.toLowerCase().includes(q) ||
        r.job_codigo.toLowerCase().includes(q) ||
        r.job_nome.toLowerCase().includes(q)
      );
    });
  }, [rows, filtro, busca]);

  return (
    <div className="space-y-4">
      {/* Cabeçalho no padrão de Recorrências: chips + busca numa linha só.
          Sem botão de criação — PP nasce em Compras, não aqui. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {STATUS_FILTROS.map((f) => {
            const ativo = filtro === f.key;
            const count = contagens[f.key];
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFiltro(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  ativo
                    ? "border-california-red bg-california-red text-white"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/50",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "tabular-nums",
                    ativo ? "text-white/85" : "text-muted-foreground/70",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
          <div className="relative ml-auto min-w-[240px] max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código, fornecedor ou job..."
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Fornecedor</th>
              <th className="px-4 py-3 font-semibold">Job</th>
              <th className="px-4 py-3 font-semibold">Emissão</th>
              <th className="px-4 py-3 font-semibold text-right">Valor</th>
              <th className="px-4 py-3 font-semibold">Prazo original</th>
              <th className="px-4 py-3 font-semibold">Parcela</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "Nenhum Pedido de Produção emitido ainda."
                    : "Nenhum Pedido de Produção encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {filtrados.map((r) => (
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setPpSelecionada(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPpSelecionada(r);
                  }
                }}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40"
              >
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold text-california-red">
                  {r.codigo}
                </td>
                <td className="px-4 py-3">{r.fornecedor_nome}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="font-mono text-xs">{r.job_codigo}</span>{" "}
                  <span>{r.job_nome}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(r.created_at)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {formatMoney(r.valor)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(r.prazo_pagamento)}</td>
                {/* Parcela: a PP parcelada aparece como "1/3" — quantas vezes
                    o financeiro vai pagar. Cada parcela vira uma linha
                    própria na aba "Títulos a Pagar". */}
                <td className="px-4 py-3">
                  <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
                    1/{Math.max(r.parcelas.length, 1)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(r.status))}>
                    {ppStatusLabel(r.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PPDrawerFinanceiro
        pp={ppSelecionada}
        open={ppSelecionada !== null}
        onOpenChange={(open) => {
          if (!open) setPpSelecionada(null);
        }}
      />
    </div>
  );
}
