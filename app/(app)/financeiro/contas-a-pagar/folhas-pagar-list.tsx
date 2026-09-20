"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Empresa, FolhaLinhaStatus, TipoContratacao } from "@/lib/types";
import { folhaLinhaStatusLabel } from "@/lib/types";
import { RevisarFolhaDrawer } from "./revisar-folha-drawer";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export type FolhaLinhaFinanceiro = {
  id: string;
  competencia_ano: number;
  competencia_mes: number;
  salario_base: string;
  status: FolhaLinhaStatus;
  motivo_pendencia: string | null;
  colaborador: {
    id: string;
    nome: string;
    funcao: string;
    tipo_contratacao: TipoContratacao;
  };
  alocacoes: {
    id: string;
    empresa_id: string;
    regional_id: string;
    percentual: string;
    empresa_nome: string;
    regional_nome: string;
  }[];
};

type StatusFiltro = "todos" | FolhaLinhaStatus;

export function FolhasPagarList({
  linhas,
  empresas,
  regionais,
}: {
  linhas: FolhaLinhaFinanceiro[];
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
}) {
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("todos");
  const [linhaRevisando, setLinhaRevisando] =
    React.useState<FolhaLinhaFinanceiro | null>(null);

  const filtradas = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (status !== "todos" && l.status !== status) return false;
      if (!q) return true;
      return (
        l.colaborador.nome.toLowerCase().includes(q) ||
        l.colaborador.funcao.toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, status]);

  const contagem = React.useMemo(() => {
    const c = { enviada: 0, pendente_correcao: 0 };
    for (const l of linhas) {
      if (l.status === "enviada") c.enviada += 1;
      if (l.status === "pendente_correcao") c.pendente_correcao += 1;
    }
    return c;
  }, [linhas]);

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma folha aguardando ação. Quando o RH enviar, aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Input
            placeholder="Buscar por nome ou função..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFiltro)}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos ({linhas.length})</SelectItem>
            <SelectItem value="enviada">
              Aguardando aprovação ({contagem.enviada})
            </SelectItem>
            <SelectItem value="pendente_correcao">
              Aguardando o RH corrigir ({contagem.pendente_correcao})
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                Competência
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Colaborador
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Alocação
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-40">
                Valor
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr
                key={l.id}
                onClick={() => setLinhaRevisando(l)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLinhaRevisando(l);
                  }
                }}
                className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {NOMES_MES[l.competencia_mes - 1]}/{l.competencia_ano}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{l.colaborador.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.colaborador.funcao}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {l.alocacoes.map((a) => (
                    <div key={a.id}>
                      {a.empresa_nome} · {a.regional_nome} ·{" "}
                      <span className="tabular-nums font-medium">
                        {Number(a.percentual).toFixed(2).replace(".", ",")}%
                      </span>
                    </div>
                  ))}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(Number(l.salario_base))}
                </td>
                <td className="px-4 py-3">
                  <BadgeStatus status={l.status} />
                  {l.status === "pendente_correcao" && l.motivo_pendencia && (
                    <div className="mt-1 flex items-start gap-1 text-[10px] text-california-red">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{l.motivo_pendencia}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhuma linha corresponde aos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {linhaRevisando && (
        <RevisarFolhaDrawer
          linha={linhaRevisando}
          empresas={empresas}
          regionais={regionais}
          open={!!linhaRevisando}
          onOpenChange={(next) => {
            if (!next) setLinhaRevisando(null);
          }}
        />
      )}
    </div>
  );
}

function BadgeStatus({ status }: { status: FolhaLinhaStatus }) {
  const cores: Record<FolhaLinhaStatus, string> = {
    rascunho: "bg-muted text-muted-foreground",
    enviada: "bg-blue-50 text-blue-700",
    aprovada: "bg-emerald-50 text-emerald-700",
    pendente_correcao: "bg-california-red/10 text-california-red",
    paga: "bg-emerald-600 text-white",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cores[status]}`}
    >
      {folhaLinhaStatusLabel(status)}
    </span>
  );
}
