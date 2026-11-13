"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { tipoContratacaoLabel, type TipoContratacao } from "@/lib/types";
import type { NivelPendenciaFerias } from "@/lib/rh/pendencias-ferias";
import type { PendenciaColaboradorRow } from "./aba-pendencias";
import { DrawerPendenciasColaborador } from "./drawer-pendencias-colaborador";

type Props = {
  rows: PendenciaColaboradorRow[];
};

export function PendenciasListaCliente({ rows }: Props) {
  const [selecionado, setSelecionado] = React.useState<
    PendenciaColaboradorRow | null
  >(null);

  const totalCriticas = rows.filter((r) => r.nivel === "critica").length;
  const totalAlertas = rows.filter((r) => r.nivel === "alerta").length;
  const totalInfos = rows.filter((r) => r.nivel === "info").length;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
        <p className="text-base font-medium">Sem pendências</p>
        <p className="text-sm text-muted-foreground mt-1">
          Todos os colaboradores estão com o histórico de férias consistente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumo no topo */}
      <div className="flex flex-wrap gap-3">
        <BadgeResumo
          nivel="critica"
          count={totalCriticas}
          label="críticas"
        />
        <BadgeResumo nivel="alerta" count={totalAlertas} label="alertas" />
        <BadgeResumo nivel="info" count={totalInfos} label="informativos" />
      </div>

      {/* Lista de colaboradores */}
      <div className="rounded-xl border border-border overflow-hidden bg-background">
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <LinhaPendencia
              key={row.colaborador_id}
              row={row}
              onAbrir={() => setSelecionado(row)}
            />
          ))}
        </ul>
      </div>

      {selecionado && (
        <DrawerPendenciasColaborador
          row={selecionado}
          aberto={selecionado !== null}
          onFechar={() => setSelecionado(null)}
        />
      )}
    </div>
  );
}

function BadgeResumo({
  nivel,
  count,
  label,
}: {
  nivel: NivelPendenciaFerias;
  count: number;
  label: string;
}) {
  const Icon = iconePorNivel(nivel);
  const cls = classPorNivel(nivel);
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${cls}`}
    >
      <Icon className="h-4 w-4" />
      <span className="font-semibold">{count}</span>
      <span className="text-xs opacity-80">{label}</span>
    </div>
  );
}

function LinhaPendencia({
  row,
  onAbrir,
}: {
  row: PendenciaColaboradorRow;
  onAbrir: () => void;
}) {
  const Icon = iconePorNivel(row.nivel);
  const cls = classPorNivel(row.nivel);
  const tipoLabel = tipoContratacaoLabel(
    row.tipo_contratacao as TipoContratacao,
  ).split(" ")[0];

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="grid md:grid-cols-[auto_2fr_2fr_auto] items-center gap-4 px-5 py-3 cursor-pointer transition-colors hover:bg-muted/30"
    >
      <div
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${cls}`}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{row.nome}</p>
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          {tipoLabel}
        </p>
      </div>

      <div className="hidden md:flex flex-wrap gap-1.5">
        {row.resumo.criticas > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-california-red/10 text-california-red px-2 py-0.5 text-xs">
            {row.resumo.criticas} crítica
            {row.resumo.criticas > 1 ? "s" : ""}
          </span>
        )}
        {row.resumo.alertas > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-xs">
            {row.resumo.alertas} alerta
            {row.resumo.alertas > 1 ? "s" : ""}
          </span>
        )}
        {row.resumo.infos > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-900 px-2 py-0.5 text-xs">
            {row.resumo.infos} info
          </span>
        )}
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </li>
  );
}

function iconePorNivel(nivel: NivelPendenciaFerias) {
  if (nivel === "critica") return AlertCircle;
  if (nivel === "alerta") return AlertTriangle;
  if (nivel === "info") return Info;
  return CheckCircle2;
}

function classPorNivel(nivel: NivelPendenciaFerias) {
  if (nivel === "critica")
    return "border-california-red/30 bg-california-red/10 text-california-red";
  if (nivel === "alerta") return "border-amber-300/60 bg-amber-50 text-amber-900";
  if (nivel === "info") return "border-blue-300/60 bg-blue-50 text-blue-900";
  return "border-emerald-300/60 bg-emerald-50 text-emerald-900";
}
