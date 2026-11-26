"use client";

import * as React from "react";
import { X, Pencil } from "lucide-react";
import type {
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
} from "@/lib/types";
import { DialogCancelarLancamento } from "../dialog-cancelar-lancamento";
import { DialogEditarPeriodo } from "../dialog-editar-periodo";

const STATUSES_PODE_CANCELAR: FeriasLancamentoStatus[] = [
  "aguardando_gestor",
  "pendente_aprovacao",
  "aprovado",
  "nf_anexada",
];

const STATUSES_PODE_EDITAR: FeriasLancamentoStatus[] = [
  "aguardando_gestor",
  "pendente_aprovacao",
];

export function BotoesRhLancamento({
  lancamentoId,
  status,
  dataInicio,
  dataFim,
  periodoId,
  tipoLancamento,
  aquisitivos,
}: {
  lancamentoId: string;
  status: FeriasLancamentoStatus;
  dataInicio: string;
  dataFim: string;
  periodoId: string | null;
  tipoLancamento: FeriasLancamentoTipo;
  aquisitivos: Array<{ id: string; rotulo: string; saldo: number }>;
}) {
  const [cancelandoAberto, setCancelandoAberto] = React.useState(false);
  const [editandoAberto, setEditandoAberto] = React.useState(false);

  const podeCancelar = STATUSES_PODE_CANCELAR.includes(status);
  const podeEditar = STATUSES_PODE_EDITAR.includes(status);

  if (!podeCancelar && !podeEditar) return null;

  return (
    <>
      <div className="mt-3 flex items-center gap-2 pt-3 border-t border-border">
        {podeEditar && (
          <button
            type="button"
            onClick={() => setEditandoAberto(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
          >
            <Pencil className="h-3 w-3" />
            Editar período
          </button>
        )}
        {podeCancelar && (
          <button
            type="button"
            onClick={() => setCancelandoAberto(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors"
          >
            <X className="h-3 w-3" />
            Cancelar
          </button>
        )}
      </div>

      {cancelandoAberto && (
        <DialogCancelarLancamento
          aberto={cancelandoAberto}
          lancamentoId={lancamentoId}
          statusLancamento={status}
          onFechar={() => setCancelandoAberto(false)}
        />
      )}

      {editandoAberto && (
        <DialogEditarPeriodo
          aberto={editandoAberto}
          lancamentoId={lancamentoId}
          dataInicioAtual={dataInicio}
          dataFimAtual={dataFim}
          periodoIdAtual={periodoId}
          tipoLancamento={tipoLancamento}
          aquisitivosDisponiveis={aquisitivos}
          onFechar={() => setEditandoAberto(false)}
        />
      )}
    </>
  );
}
