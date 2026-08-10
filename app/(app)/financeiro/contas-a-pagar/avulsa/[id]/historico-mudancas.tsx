"use client";

import type { ContaAvulsaHistorico } from "@/lib/types";

interface Row extends ContaAvulsaHistorico {
  alterado_por_profile: { nome: string } | null;
}

// Rótulos em pt-BR para os campos armazenados como snake_case.
const LABEL_CAMPO: Record<string, string> = {
  descricao: "Descrição",
  valor: "Valor",
  natureza: "Natureza",
  data_prevista_pagamento: "Data prevista de pagamento",
  fornecedor_id: "Fornecedor",
  cliente_id: "Cliente",
  job_id: "Job",
  plano_conta_tipo_id: "Tipo de plano de contas",
  plano_conta_subtipo_id: "Subtipo de plano de contas",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function renderValor(campo: string, v: string | null): string {
  if (v == null || v === "") return "—";
  if (campo === "valor") {
    return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (campo === "natureza") {
    return v === "entrada" ? "Entrada" : "Saída";
  }
  // FKs: mostra só os primeiros 8 chars + "..." para rastreabilidade sem joins adicionais.
  if (campo.endsWith("_id")) {
    return v.slice(0, 8) + "...";
  }
  return v;
}

export function HistoricoMudancas({ historico }: { historico: Row[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
        Histórico de mudanças
      </h2>
      {historico.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Data/Hora</th>
                <th className="px-3 py-2 text-left">Usuário</th>
                <th className="px-3 py-2 text-left">Campo</th>
                <th className="px-3 py-2 text-left">Valor anterior</th>
                <th className="px-3 py-2 text-left">Valor novo</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{formatDateTime(h.alterado_em)}</td>
                  <td className="px-3 py-2">{h.alterado_por_profile?.nome ?? "—"}</td>
                  <td className="px-3 py-2 font-semibold">
                    {LABEL_CAMPO[h.campo_alterado] ?? h.campo_alterado}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {renderValor(h.campo_alterado, h.valor_anterior)}
                  </td>
                  <td className="px-3 py-2">
                    {renderValor(h.campo_alterado, h.valor_novo)}
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
