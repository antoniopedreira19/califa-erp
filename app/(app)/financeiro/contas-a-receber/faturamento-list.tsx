"use client";

import * as React from "react";
import { Plus, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { FaturarDrawer } from "./faturar-drawer";

export type FaturamentoPendenteRow = {
  origem_tipo: "job" | "bv";
  origem_id: string;
  empresa_id: string;
  codigo: string | null;
  descricao: string;
  cliente_id: string | null;
  fornecedor_id: string | null;
  valor_previsto: number;
  valor_ja_faturado: number;
  saldo: number;
  data_prevista: string | null;
};

const CHIP_ORIGEM: Record<FaturamentoPendenteRow["origem_tipo"] | "avulso", string> = {
  job: "Job",
  bv: "BV",
  avulso: "Avulso",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface Props {
  pendentes: FaturamentoPendenteRow[];
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
}

export function FaturamentoList({
  pendentes,
  contas,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
}: Props) {
  const [drawerState, setDrawerState] = React.useState<
    | { modo: "origem"; row: FaturamentoPendenteRow }
    | { modo: "avulso" }
    | null
  >(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDrawerState({ modo: "avulso" })}>
          <Plus className="mr-1 h-4 w-4" />
          Novo Faturamento avulso
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Origem</th>
              <th className="p-3 text-left">Descrição</th>
              <th className="p-3 text-left">Contraparte</th>
              <th className="p-3 text-right">Previsto</th>
              <th className="p-3 text-right">Já faturado</th>
              <th className="p-3 text-right">Saldo</th>
              <th className="p-3 text-left">Data prevista</th>
              <th className="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {pendentes.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  Nada aguardando faturamento no momento.
                </td>
              </tr>
            )}
            {pendentes.map((r) => {
              const contraparte =
                r.origem_tipo === "bv"
                  ? fornecedores.find((f) => f.id === r.fornecedor_id)?.nome ?? "—"
                  : clientes.find((c) => c.id === r.cliente_id)?.nome ?? "—";
              return (
                <tr
                  key={`${r.origem_tipo}:${r.origem_id}`}
                  className="border-t border-border hover:bg-muted/40 transition-colors"
                >
                  <td className="p-3">
                    <Badge variant="neutral">{CHIP_ORIGEM[r.origem_tipo]}</Badge>
                  </td>
                  <td className="p-3 max-w-xs truncate" title={r.descricao}>
                    {r.codigo && <span className="font-mono text-xs mr-1">{r.codigo}</span>}
                    {r.descricao}
                  </td>
                  <td className="p-3">{contraparte}</td>
                  <td className="p-3 text-right font-mono">{formatCurrency(r.valor_previsto, "BRL")}</td>
                  <td className="p-3 text-right font-mono text-muted-foreground">
                    {formatCurrency(r.valor_ja_faturado, "BRL")}
                  </td>
                  <td className="p-3 text-right font-mono font-semibold">
                    {formatCurrency(r.saldo, "BRL")}
                  </td>
                  <td className="p-3">{formatDate(r.data_prevista)}</td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      onClick={() => setDrawerState({ modo: "origem", row: r })}
                    >
                      <FileText className="mr-1 h-3 w-3" />
                      Faturar
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawerState && (
        <FaturarDrawer
          state={drawerState}
          onClose={() => setDrawerState(null)}
          contas={contas}
          tipos={tipos}
          subtipos={subtipos}
          empresas={empresas}
          clientes={clientes}
          fornecedores={fornecedores}
        />
      )}
    </div>
  );
}
