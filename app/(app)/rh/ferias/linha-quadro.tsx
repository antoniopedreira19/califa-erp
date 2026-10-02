"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import type { FeriasPeriodoStatus } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import type { QuadroColaboradorRow } from "./aba-quadro";

type Props = {
  row: QuadroColaboradorRow;
  /** Callback de abertura do modal — gerenciado por state local no
   *  QuadroListaCliente pra evitar round-trip RSC (Onda 3). */
  onAbrir: () => void;
};

export function LinhaQuadro({ row, onAbrir }: Props) {
  function abrirDetalhe() {
    onAbrir();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrirDetalhe();
    }
  }

  const admissaoFmt = row.data_admissao
    ? new Date(row.data_admissao + "T00:00:00").toLocaleDateString("pt-BR")
    : "—";

  const limiteFmt = row.periodoAtivo?.data_limite_gozo
    ? new Date(
        row.periodoAtivo.data_limite_gozo + "T00:00:00",
      ).toLocaleDateString("pt-BR")
    : "—";

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={abrirDetalhe}
      onKeyDown={onKeyDown}
      className="grid md:grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr_1fr_0.3fr] gap-x-4 gap-y-1 px-5 py-3 cursor-pointer transition-colors hover:bg-muted/30"
    >
      {/* Colaborador: nome + função + tipo */}
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{row.nome}</p>
        <p className="text-xs text-muted-foreground truncate">
          {row.funcao} ·{" "}
          <span className="uppercase tracking-wider">
            {tipoContratacaoLabel(row.tipo_contratacao).split(" ")[0]}
          </span>
        </p>
      </div>

      {/* Admissão */}
      <p className="hidden md:block self-center text-sm text-foreground">
        {admissaoFmt}
      </p>

      {/* Aquisitivo */}
      <p className="hidden md:block self-center text-sm font-medium">
        {row.periodoAtivo?.rotulo ?? "—"}
      </p>

      {/* Dias pendentes */}
      <div className="hidden md:block self-center">
        {row.periodoAtivo ? (
          <p className="text-sm">
            <span className="font-semibold">
              {row.periodoAtivo.dias_pendentes}
            </span>
            <span className="text-xs text-muted-foreground">
              {" "}de {row.periodoAtivo.dias_direito}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>

      {/* Situação */}
      <div className="hidden md:block self-center">
        {row.periodoAtivo ? (
          <BadgeSituacao
            status={row.periodoAtivo.status}
            diasAteLimite={row.periodoAtivo.diasAteLimite}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Sem período</span>
        )}
      </div>

      {/* Data limite */}
      <div className="hidden md:block self-center">
        {row.periodoAtivo ? (
          <div>
            <p className="text-sm">{limiteFmt}</p>
            <p
              className={`text-xs ${tomDiasAteLimite(row.periodoAtivo.diasAteLimite)}`}
            >
              {row.periodoAtivo.diasAteLimite > 0
                ? `em ${row.periodoAtivo.diasAteLimite} dias`
                : `há ${-row.periodoAtivo.diasAteLimite} dias`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>

      {/* Chevron de ação */}
      <div className="hidden md:flex self-center justify-end">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* MOBILE: card compacto com resumo */}
      <div className="md:hidden mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            Aquisitivo <span className="font-medium">{row.periodoAtivo?.rotulo ?? "—"}</span>
            {row.periodoAtivo &&
              ` · ${row.periodoAtivo.dias_pendentes}/${row.periodoAtivo.dias_direito} dias pend.`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Limite:{" "}
            <span className="font-medium">{limiteFmt}</span>
            {row.periodoAtivo && (
              <span
                className={`ml-1 ${tomDiasAteLimite(row.periodoAtivo.diasAteLimite)}`}
              >
                ({row.periodoAtivo.diasAteLimite > 0
                  ? `em ${row.periodoAtivo.diasAteLimite}d`
                  : `há ${-row.periodoAtivo.diasAteLimite}d`})
              </span>
            )}
          </p>
        </div>
        {row.periodoAtivo && (
          <BadgeSituacao
            status={row.periodoAtivo.status}
            diasAteLimite={row.periodoAtivo.diasAteLimite}
          />
        )}
      </div>
    </li>
  );
}

function tomDiasAteLimite(dias: number): string {
  if (dias < 0) return "text-red-700 font-medium";
  if (dias <= 60) return "text-amber-700 font-medium";
  return "text-muted-foreground";
}

function BadgeSituacao({
  status,
  diasAteLimite,
}: {
  status: FeriasPeriodoStatus;
  diasAteLimite: number;
}) {
  // Rótulos alinhados com os da aba "Acompanhamento" da planilha
  const map: Record<FeriasPeriodoStatus, { label: string; cls: string }> = {
    incompleto: {
      label: "Período incompleto",
      cls: "bg-muted text-muted-foreground",
    },
    apto: {
      label: diasAteLimite <= 60 ? "Em alerta" : "Dentro do prazo",
      cls:
        diasAteLimite <= 60
          ? "bg-amber-100 text-amber-900"
          : "bg-emerald-100 text-emerald-800",
    },
    em_alerta: { label: "Em alerta", cls: "bg-amber-100 text-amber-900" },
    vencido: { label: "Vencido", cls: "bg-red-100 text-red-800" },
    regularizado: {
      label: "Regularizado",
      cls: "bg-sky-100 text-sky-800",
    },
    nao_habilitado: {
      label: "Não habilitado",
      cls: "bg-muted text-muted-foreground",
    },
    pago_rescisao: {
      label: "Pago em rescisão",
      cls: "bg-slate-200 text-slate-700",
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}
    >
      {info.label}
    </span>
  );
}
