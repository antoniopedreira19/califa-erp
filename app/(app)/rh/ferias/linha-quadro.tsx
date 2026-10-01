"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { FeriasPeriodoStatus, TipoContratacao } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import type { QuadroColaboradorRow } from "./aba-quadro";

type Props = {
  row: QuadroColaboradorRow;
};

export function LinhaQuadro({ row }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function abrirDrawer() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("colab", row.id);
    router.push(`/rh/ferias?${params.toString()}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrirDrawer();
    }
  }

  const proximoFmt = row.proximoVencimento
    ? new Date(row.proximoVencimento + "T00:00:00").toLocaleDateString("pt-BR")
    : null;

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={abrirDrawer}
      onKeyDown={onKeyDown}
      className="grid md:grid-cols-[1.5fr_0.6fr_1fr_0.8fr_1.1fr] gap-x-4 gap-y-1 px-5 py-3 transition-colors cursor-pointer hover:bg-muted/30"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{row.nome}</p>
        <p className="text-xs text-muted-foreground truncate md:hidden">
          {row.funcao}
        </p>
      </div>

      <p className="hidden md:block text-xs text-muted-foreground uppercase tracking-wider self-center">
        {tipoContratacaoLabel(row.tipo_contratacao).split(" ")[0]}
      </p>

      <div className="self-center">
        <StatusBadge status={row.statusPrincipal} />
      </div>

      <div className="self-center">
        <p className="text-sm font-semibold">
          {row.saldoTotal}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {row.saldoTotal === 1 ? "dia" : "dias"}
          </span>
        </p>
      </div>

      <div className="self-center flex items-center justify-between gap-2">
        {proximoFmt ? (
          <div>
            <p className="text-sm">{proximoFmt}</p>
            {row.diasProximoVencimento !== null && (
              <p className={`text-xs ${tomVencimento(row.diasProximoVencimento)}`}>
                {row.diasProximoVencimento > 0
                  ? `em ${row.diasProximoVencimento} dias`
                  : `há ${-row.diasProximoVencimento} dias`}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </li>
  );
}

function tomVencimento(dias: number): string {
  if (dias < 0) return "text-red-700 font-medium";
  if (dias <= 60) return "text-amber-700 font-medium";
  return "text-muted-foreground";
}

function StatusBadge({
  status,
}: {
  status: FeriasPeriodoStatus | "sem_direito";
}) {
  const map: Record<string, { label: string; cls: string }> = {
    incompleto: { label: "Em curso", cls: "bg-muted text-muted-foreground" },
    apto: { label: "Apto", cls: "bg-emerald-100 text-emerald-800" },
    em_alerta: { label: "Em alerta", cls: "bg-amber-100 text-amber-900" },
    vencido: { label: "Vencido", cls: "bg-red-100 text-red-800" },
    regularizado: { label: "Regularizado", cls: "bg-sky-100 text-sky-800" },
    nao_habilitado: {
      label: "Não habilitado",
      cls: "bg-muted text-muted-foreground",
    },
    pago_rescisao: {
      label: "Pago em rescisão",
      cls: "bg-slate-200 text-slate-700",
    },
    sem_direito: {
      label: "Sem direito ainda",
      cls: "bg-muted text-muted-foreground",
    },
  };
  const info = map[status] ?? map.sem_direito;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}
    >
      {info.label}
    </span>
  );
}
