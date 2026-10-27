"use client";

import * as React from "react";
import { History } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SolicitarFeriasForm,
  type SolicitarFeriasPayload,
} from "@/app/(app)/_components/solicitar-ferias-form";
import type {
  ColaboradorFeriasPeriodo,
  TipoContratacao,
} from "@/lib/types";
import { lancarDiretoPeloRh } from "./actions";

type PeriodoComSaldo = ColaboradorFeriasPeriodo & { saldo: number };

type Props = {
  colaboradorId: string;
  tipoContratacao: TipoContratacao;
  periodosComSaldo: PeriodoComSaldo[];
  onFechar: () => void;
  onSucesso: () => void;
};

export function LancarDiretoForm({
  colaboradorId,
  tipoContratacao,
  periodosComSaldo,
  onFechar,
  onSucesso,
}: Props) {
  const [modoRetroativo, setModoRetroativo] = React.useState(false);

  // Default: só períodos acionáveis hoje (apto/em_alerta/vencido) com saldo > 0.
  // Modo retroativo: inclui regularizados (lançamento histórico).
  const periodosExibidos = React.useMemo(() => {
    const ativos = periodosComSaldo.filter(
      (p) =>
        (p.status === "apto" ||
          p.status === "em_alerta" ||
          p.status === "vencido") &&
        p.saldo > 0,
    );
    if (!modoRetroativo) return ativos;
    const regularizados = periodosComSaldo.filter(
      (p) => p.status === "regularizado",
    );
    return [...ativos, ...regularizados];
  }, [periodosComSaldo, modoRetroativo]);

  async function handleSubmit(payload: SolicitarFeriasPayload) {
    return lancarDiretoPeloRh({
      colaborador_id: colaboradorId,
      ...payload,
    });
  }

  return (
    <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-5 space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Lançar férias</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Entra como <strong>aprovado</strong>, pulando o pedido do colaborador.
          Use para férias já combinadas fora do sistema ou registros
          retroativos.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={modoRetroativo}
          onCheckedChange={(v) => setModoRetroativo(v === true)}
        />
        <History className="h-3.5 w-3.5" />
        Lançamento retroativo (inclui períodos já regularizados)
      </label>

      <SolicitarFeriasForm
        periodos={periodosExibidos}
        tipoContratacao={tipoContratacao}
        modo="rh"
        onSubmit={handleSubmit}
        onSucesso={onSucesso}
        onCancelar={onFechar}
      />
    </div>
  );
}
