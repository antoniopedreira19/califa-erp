"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Users,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  cn,
  formatCpf,
  formatCurrency,
  nomeCurto,
  diasAteVencimento,
  tempoDesde,
  initials,
} from "@/lib/utils";
import type {
  AcaoPrevistaFreelancer,
  FreelancerComStatus,
  StatusCalculado,
  TipoFreelancerContrato,
} from "@/lib/types";
import { AcaoPrevistaBadge } from "./acao-prevista-badge";
import { StatusBadge } from "../../_components/status-badge";
import { ToggleAcaoPrevista } from "./toggle-acao-prevista";

interface Props {
  freelancers: FreelancerComStatus[];
  podeEditar: boolean;
}

const TIPO_LABEL: Record<TipoFreelancerContrato, string> = {
  mensal: "Mensal",
  periodo: "Período",
  diarias: "Diárias",
};

export function ListaClient({ freelancers, podeEditar }: Props) {
  const [valoresVisiveis, setValoresVisiveis] = React.useState(false);

  if (freelancers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">
          Nenhum freelancer encontrado
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ajuste a busca ou os filtros.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/20 border-b border-border">
            <tr>
              <Th>Freelancer</Th>
              <Th>Job</Th>
              <Th>Cargo</Th>
              <Th>Resp.</Th>
              <Th align="center">
                <span className="inline-flex items-center gap-1.5">
                  Valor
                  <button
                    type="button"
                    onClick={() => setValoresVisiveis((v) => !v)}
                    className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    title={valoresVisiveis ? "Esconder valores" : "Mostrar valores"}
                  >
                    {valoresVisiveis ? (
                      <Eye className="h-3 w-3" />
                    ) : (
                      <EyeOff className="h-3 w-3" />
                    )}
                  </button>
                </span>
              </Th>
              <Th align="center">Vence</Th>
              <Th align="center">Contrato</Th>
              <Th align="center">Status</Th>
              <Th align="center">Tempo</Th>
              <Th align="center">Ação</Th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {freelancers.map((f) => (
              <FreelancerRow
                key={f.id}
                f={f}
                podeEditar={podeEditar}
                valoresVisiveis={valoresVisiveis}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FreelancerRow({
  f,
  podeEditar,
  valoresVisiveis,
}: {
  f: FreelancerComStatus;
  podeEditar: boolean;
  valoresVisiveis: boolean;
}) {
  const href = `/freelancers/${f.id}`;
  const dias = diasAteVencimento(f.data_termino);
  const vencido = dias !== null && dias < 0;
  const tempo = f.status_real === true ? tempoDesde(f.data_inicio) : null;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-california-red/[0.02] transition-colors group">
      <td className="px-3 py-2.5">
        <Link
          href={href}
          prefetch={false}
          className="block"
        >
          <p className="font-semibold text-foreground uppercase tracking-wide group-hover:text-california-red transition-colors leading-tight max-w-[200px] truncate" title={f.nome_completo || f.nome_social}>
            {nomeCurto(f.nome_completo || f.nome_social)}
          </p>
          {f.cpf ? (
            <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
              {formatCpf(f.cpf)}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">sem CPF</p>
          )}
        </Link>
      </td>
      <td className="px-3 py-2.5">
        {(() => {
          // Fallback pro texto preservado dos contratos migrados do RH antigo
          // (job_id null, mas `nome_job` traz o nome como texto).
          const nomeExibir = f.job_nome ?? f.nome_job;
          return nomeExibir ? (
            <span
              className="text-[11px] text-foreground font-medium truncate block max-w-[160px]"
              title={nomeExibir}
            >
              {f.job_codigo && (
                <span className="text-muted-foreground tabular-nums mr-1">
                  {f.job_codigo}
                </span>
              )}
              {nomeExibir}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        })()}
      </td>
      <td className="px-3 py-2.5">
        <span
          className="text-[11px] text-muted-foreground uppercase tracking-wide truncate block max-w-[120px]"
          title={f.cargo_contrato ?? undefined}
        >
          {f.cargo_contrato ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {f.responsavel_nome ? (
          <div className="flex items-center gap-1.5" title={f.responsavel_nome}>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-california-red/10 text-california-red text-[9px] font-bold shrink-0">
              {initials(f.responsavel_nome)}
            </div>
            <span className="text-[11px] font-medium text-foreground truncate max-w-[100px]">
              {nomeCurto(f.responsavel_nome)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        {f.valor !== null && f.valor !== undefined ? (
          <div className="inline-flex flex-col items-center">
            <span className="text-[11px] font-semibold tabular-nums text-foreground whitespace-nowrap select-none">
              {valoresVisiveis
                ? formatCurrency(Number(f.valor))
                : "R$ ••••••"}
            </span>
            {f.tipo && (
              <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                {TIPO_LABEL[f.tipo]}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        {f.data_termino ? (
          <span
            className={cn(
              "text-[11px] font-semibold tabular-nums whitespace-nowrap",
              vencido ? "text-california-red" : "text-foreground",
            )}
          >
            {vencido
              ? "Vencido"
              : new Date(f.data_termino + "T00:00:00").toLocaleDateString(
                  "pt-BR",
                  { day: "2-digit", month: "2-digit", year: "2-digit" },
                )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusRealBadge ativo={f.status_real} />
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge status={f.status_calculado as StatusCalculado} />
      </td>
      <td className="px-3 py-2.5 text-center">
        {tempo ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground tabular-nums whitespace-nowrap"
            title={`Trabalhando há ${tempo}`}
          >
            <Clock className="h-3 w-3 text-muted-foreground/70" />
            {tempo}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td
        className="px-3 py-2.5 text-center"
        onClick={(e) => podeEditar && e.stopPropagation()}
      >
        {podeEditar ? (
          <ToggleAcaoPrevista
            freelancerId={f.id}
            valorAtual={f.acao_prevista as AcaoPrevistaFreelancer | null}
          />
        ) : (
          <AcaoPrevistaBadge
            acao={f.acao_prevista as AcaoPrevistaFreelancer | null}
          />
        )}
      </td>
      <td className="px-2 py-2.5 text-right">
        <Link
          href={href}
          prefetch={false}
          aria-label={`Abrir ${f.nome_social}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-california-red hover:bg-california-red/10 transition-colors"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]",
        align === "center"
          ? "text-center"
          : align === "right"
            ? "text-right"
            : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function StatusRealBadge({ ativo }: { ativo: boolean | null }) {
  if (ativo === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        ativo ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ativo ? "bg-emerald-500" : "bg-zinc-400",
        )}
      />
      {ativo ? "Trabalhando" : "Inativo"}
    </span>
  );
}
