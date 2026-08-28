"use client";

import * as React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  LABELS_STATUS_FATURAMENTO,
  type StatusFaturamento,
} from "@/lib/relatorios/faturamento-status";

/** Uma linha da tabela — os campos derivados (saldo, status) já vêm prontos. */
export interface LinhaFaturamento {
  job_id: string;
  job_codigo: string;
  job_nome: string;
  valor_job: number;
  valor_faturado: number;
  saldo: number;
  status: StatusFaturamento;
  data_abertura: string;
}

type CampoOrdenacao =
  | "job"
  | "valor_job"
  | "valor_faturado"
  | "saldo"
  | "status"
  | "data_abertura";

type Direcao = "asc" | "desc";

interface Props {
  linhas: LinhaFaturamento[];
}

const ORDEM_STATUS: Record<StatusFaturamento, number> = {
  nao_faturado: 0,
  parcial: 1,
  faturado: 2,
};

export function TabelaFaturamento({ linhas }: Props) {
  const [ordenacao, setOrdenacao] = React.useState<{
    campo: CampoOrdenacao;
    direcao: Direcao;
  }>({ campo: "valor_job", direcao: "desc" });

  const trocarOrdenacao = (campo: CampoOrdenacao) => {
    setOrdenacao((atual) =>
      atual.campo === campo
        ? { campo, direcao: atual.direcao === "asc" ? "desc" : "asc" }
        : { campo, direcao: "desc" },
    );
  };

  const linhasOrdenadas = React.useMemo(() => {
    const copia = [...linhas];
    const dir = ordenacao.direcao === "asc" ? 1 : -1;
    copia.sort((a, b) => {
      switch (ordenacao.campo) {
        case "job":
          return dir * a.job_nome.localeCompare(b.job_nome, "pt-BR");
        case "valor_job":
          return dir * (a.valor_job - b.valor_job);
        case "valor_faturado":
          return dir * (a.valor_faturado - b.valor_faturado);
        case "saldo":
          return dir * (a.saldo - b.saldo);
        case "status":
          return dir * (ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status]);
        case "data_abertura":
          return dir * a.data_abertura.localeCompare(b.data_abertura);
      }
    });
    return copia;
  }, [linhas, ordenacao]);

  if (linhas.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum resultado encontrado com os filtros atuais.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <HeaderOrdenavel
              campo="job"
              rotulo="Job"
              ordenacao={ordenacao}
              onTrocar={trocarOrdenacao}
              align="left"
            />
            <HeaderOrdenavel
              campo="valor_job"
              rotulo="Valor do Job"
              ordenacao={ordenacao}
              onTrocar={trocarOrdenacao}
              align="right"
            />
            <HeaderOrdenavel
              campo="valor_faturado"
              rotulo="Valor Faturado"
              ordenacao={ordenacao}
              onTrocar={trocarOrdenacao}
              align="right"
            />
            <HeaderOrdenavel
              campo="saldo"
              rotulo="Saldo"
              ordenacao={ordenacao}
              onTrocar={trocarOrdenacao}
              align="right"
            />
            <HeaderOrdenavel
              campo="status"
              rotulo="Status"
              ordenacao={ordenacao}
              onTrocar={trocarOrdenacao}
              align="center"
            />
            <HeaderOrdenavel
              campo="data_abertura"
              rotulo="Data Abertura"
              ordenacao={ordenacao}
              onTrocar={trocarOrdenacao}
              align="center"
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhasOrdenadas.map((l) => (
            <tr key={l.job_id} className="hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3">
                <span className="text-foreground">
                  <span className="text-muted-foreground text-xs mr-2">
                    {l.job_codigo}
                  </span>
                  {l.job_nome}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {formatCurrency(l.valor_job, "BRL")}
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {l.valor_faturado > 0
                  ? formatCurrency(l.valor_faturado, "BRL")
                  : (
                    <span className="text-muted-foreground">R$ 0</span>
                  )}
              </td>
              <td
                className={cn(
                  "px-4 py-3 text-right font-mono",
                  l.saldo > 0.01
                    ? "text-california-red font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {formatCurrency(l.saldo, "BRL")}
              </td>
              <td className="px-4 py-3 text-center">
                <BadgeStatus status={l.status} />
              </td>
              <td className="px-4 py-3 text-center text-muted-foreground">
                {formatarData(l.data_abertura)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderOrdenavel({
  campo,
  rotulo,
  ordenacao,
  onTrocar,
  align,
}: {
  campo: CampoOrdenacao;
  rotulo: string;
  ordenacao: { campo: CampoOrdenacao; direcao: Direcao };
  onTrocar: (c: CampoOrdenacao) => void;
  align: "left" | "right" | "center";
}) {
  const ativo = ordenacao.campo === campo;
  return (
    <th
      className={cn(
        "px-4 py-3 font-semibold cursor-pointer select-none hover:text-foreground transition-colors",
        align === "left" && "text-left",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
      onClick={() => onTrocar(campo)}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          ativo && "text-foreground",
        )}
      >
        {rotulo}
        {ativo ? (
          ordenacao.direcao === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </th>
  );
}

function BadgeStatus({ status }: { status: StatusFaturamento }) {
  const cor = {
    nao_faturado: "bg-california-red/10 text-california-red",
    parcial: "bg-amber-100 text-amber-800",
    faturado: "bg-emerald-100 text-emerald-800",
  }[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
        cor,
      )}
    >
      {LABELS_STATUS_FATURAMENTO[status]}
    </span>
  );
}

function formatarData(iso: string): string {
  // Formato PT-BR: dd/mm/yyyy. `data_abertura_financeiro` vem como YYYY-MM-DD
  // da view (campo já foi castado pra ::date). Split é seguro.
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return "-";
  return `${dia}/${mes}/${ano}`;
}
