"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DesembolsoStatus } from "@/lib/types";
import { desembolsoStatusLabel } from "@/lib/types";
import { AprovarDesembolsoDialog } from "./aprovar-desembolso-dialog";
import { RejeitarDesembolsoDialog, type ModoDialog } from "./rejeitar-desembolso-dialog";

// ---------- Tipo da row (vindo do SELECT com joins) ----------

export interface DesembolsoRow {
  id: string;
  codigo: string;
  descricao: string;
  valor: number;
  status: DesembolsoStatus;
  data_prevista_pagamento: string | null;
  motivo_rejeicao: string | null;
  motivo_cancelamento: string | null;
  aprovada_em: string | null;
  rejeitada_em: string | null;
  cancelada_em: string | null;
  pago_em: string | null;
  created_at: string;
  empresa_nome: string;
  fornecedor_nome: string;
  criador_nome: string;
}

// ---------- Helpers ----------

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function statusBadgeClasses(status: DesembolsoStatus): string {
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

// ---------- Chips de filtro ----------

type FiltroStatus = "em_avaliacao" | "aprovada" | "todas";

const FILTROS: Array<{ key: FiltroStatus; label: string }> = [
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "aprovada", label: "Aprovados" },
  { key: "todas", label: "Todos" },
];

// ---------- Componente principal ----------

interface DesembolsosContasPagarListProps {
  rows: DesembolsoRow[];
}

interface DialogState {
  desembolso: DesembolsoRow | null;
  tipo: "aprovar" | "rejeitar" | "cancelar" | null;
}

export function DesembolsosContasPagarList({ rows }: DesembolsosContasPagarListProps) {
  const [filtro, setFiltro] = React.useState<FiltroStatus>("em_avaliacao");
  const [dialog, setDialog] = React.useState<DialogState>({ desembolso: null, tipo: null });

  const contagens = React.useMemo(() => {
    const c = { em_avaliacao: 0, aprovada: 0, todas: rows.length };
    for (const r of rows) {
      if (r.status === "em_avaliacao") c.em_avaliacao++;
      else if (r.status === "aprovada") c.aprovada++;
    }
    return c;
  }, [rows]);

  const filtrados = React.useMemo(() => {
    if (filtro === "todas") return rows;
    return rows.filter((r) => r.status === filtro);
  }, [rows, filtro]);

  function abrirDialog(desembolso: DesembolsoRow, tipo: "aprovar" | "rejeitar" | "cancelar") {
    setDialog({ desembolso, tipo });
  }

  function fecharDialog() {
    setDialog({ desembolso: null, tipo: null });
  }

  const desembolsoParaAprovar = dialog.tipo === "aprovar" && dialog.desembolso
    ? {
        id: dialog.desembolso.id,
        codigo: dialog.desembolso.codigo,
        descricao: dialog.desembolso.descricao,
        valor: dialog.desembolso.valor,
        status: dialog.desembolso.status,
        fornecedor_nome: dialog.desembolso.fornecedor_nome,
      }
    : null;

  const desembolsoParaRejeitar =
    (dialog.tipo === "rejeitar" || dialog.tipo === "cancelar") && dialog.desembolso
      ? {
          id: dialog.desembolso.id,
          codigo: dialog.desembolso.codigo,
          descricao: dialog.desembolso.descricao,
          valor: dialog.desembolso.valor,
          fornecedor_nome: dialog.desembolso.fornecedor_nome,
        }
      : null;

  return (
    <div className="space-y-4">
      {/* Chips de filtro */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => {
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
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Empresa</th>
              <th className="px-4 py-3 font-semibold">Fornecedor</th>
              <th className="px-4 py-3 font-semibold text-right">Valor</th>
              <th className="px-4 py-3 font-semibold">Criado por</th>
              <th className="px-4 py-3 font-semibold">Criação</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "Nenhum pedido de desembolso registrado ainda."
                    : "Nenhum pedido de desembolso encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {filtrados.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
              >
                {/* Código + descrição */}
                <td className="px-4 py-3">
                  <p className="font-mono text-xs font-bold text-california-red">{r.codigo}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{r.descricao}</p>
                </td>

                <td className="px-4 py-3 text-muted-foreground">{r.empresa_nome || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.fornecedor_nome || "—"}</td>

                <td className="px-4 py-3 text-right tabular-nums font-semibold whitespace-nowrap">
                  {formatMoney(r.valor)}
                </td>

                <td className="px-4 py-3 text-muted-foreground">{r.criador_nome || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {formatDate(r.created_at)}
                </td>

                <td className="px-4 py-3">
                  <Badge className={cn("border", statusBadgeClasses(r.status))}>
                    {desembolsoStatusLabel(r.status)}
                  </Badge>
                  {/* Motivo em leitura */}
                  {r.status === "rejeitada" && r.motivo_rejeicao && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {r.motivo_rejeicao}
                    </p>
                  )}
                  {r.status === "cancelada" && r.motivo_cancelamento && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {r.motivo_cancelamento}
                    </p>
                  )}
                </td>

                {/* Ações contextuais */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {r.status === "em_avaliacao" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => abrirDialog(r, "aprovar")}
                        >
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs border-red-300 text-red-700 hover:bg-red-50"
                          onClick={() => abrirDialog(r, "rejeitar")}
                        >
                          Rejeitar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-muted-foreground hover:bg-muted"
                          onClick={() => abrirDialog(r, "cancelar")}
                        >
                          Cancelar
                        </Button>
                      </>
                    )}

                    {r.status === "aprovada" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => abrirDialog(r, "cancelar")}
                      >
                        Cancelar
                      </Button>
                    )}

                    {(r.status === "pago" ||
                      r.status === "rejeitada" ||
                      r.status === "cancelada") && (
                      <span className="text-xs text-muted-foreground/60 italic">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      <AprovarDesembolsoDialog
        desembolso={desembolsoParaAprovar}
        open={dialog.tipo === "aprovar" && dialog.desembolso !== null}
        onOpenChange={(open) => { if (!open) fecharDialog(); }}
      />

      <RejeitarDesembolsoDialog
        desembolso={desembolsoParaRejeitar}
        open={(dialog.tipo === "rejeitar" || dialog.tipo === "cancelar") && dialog.desembolso !== null}
        onOpenChange={(open) => { if (!open) fecharDialog(); }}
        modo={(dialog.tipo === "rejeitar" ? "rejeitar" : "cancelar") as ModoDialog}
      />
    </div>
  );
}
