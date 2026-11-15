"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { FeriasPeriodoStatus } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import type { QuadroColaboradorRow } from "./aba-quadro";

type Props = {
  row: QuadroColaboradorRow;
};

export function LinhaQuadro({ row }: Props) {
  const admissaoFmt = row.data_admissao
    ? new Date(row.data_admissao + "T00:00:00").toLocaleDateString("pt-BR")
    : "—";

  const limiteFmt = row.periodoAtivo?.data_limite_gozo
    ? new Date(
        row.periodoAtivo.data_limite_gozo + "T00:00:00",
      ).toLocaleDateString("pt-BR")
    : "—";

  // Grid reduziu de 7 → 6 colunas: situação+data limite consolidaram
  // numa coluna só "Prazo" (data + label do status).
  return (
    <Link
      href={`/rh/ferias/${row.id}`}
      prefetch={false}
      className="grid md:grid-cols-[2fr_0.9fr_0.9fr_1fr_1.4fr_0.3fr] gap-x-4 gap-y-1 px-5 py-3 cursor-pointer transition-colors hover:bg-muted/30"
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

      {/* Prazo (consolidado: badge em cima, data+contagem embaixo).
          Antes: "02/06/2027 em 199d · [Pode tirar]" — cérebro lia como
          "em 199d pode tirar", ambíguo. Agora badge vem primeiro
          (ação) e a linha debaixo clarifica com "vence em X dias". */}
      <div className="hidden md:block self-center">
        {row.periodoAtivo ? (
          <div className="flex flex-col gap-1">
            <div>
              <BadgeSituacao
                status={row.periodoAtivo.status}
                diasAteLimite={row.periodoAtivo.diasAteLimite}
              />
            </div>
            <p className="text-xs text-muted-foreground leading-tight">
              <span
                className={tomDiasAteLimite(row.periodoAtivo.diasAteLimite)}
              >
                {row.periodoAtivo.diasAteLimite > 0
                  ? `Vence em ${row.periodoAtivo.diasAteLimite} dias`
                  : `Venceu há ${-row.periodoAtivo.diasAteLimite} dias`}
              </span>
              <span className="mx-1">·</span>
              <span>{limiteFmt}</span>
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
    </Link>
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
  // Rótulos pensados pra gestor de pessoas: ação em vez de categoria
  // técnica. 'Vence em breve' cobre apto <=60d + em_alerta no mesmo
  // termo porque pro RH é a mesma ação (conversar com a pessoa).
  const map: Record<FeriasPeriodoStatus, { label: string; cls: string }> = {
    incompleto: {
      label: "Gerando direito",
      cls: "bg-muted text-muted-foreground",
    },
    apto: {
      label: diasAteLimite <= 60 ? "Vence em breve" : "Pode tirar",
      cls:
        diasAteLimite <= 60
          ? "bg-amber-100 text-amber-900"
          : "bg-emerald-100 text-emerald-800",
    },
    em_alerta: {
      label: "Vence em breve",
      cls: "bg-amber-100 text-amber-900",
    },
    vencido: { label: "Vencido", cls: "bg-red-100 text-red-800" },
    regularizado: {
      label: "Férias tiradas",
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
