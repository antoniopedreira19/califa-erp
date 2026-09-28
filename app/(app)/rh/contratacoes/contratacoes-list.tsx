"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContratacaoStatus, TipoContratacao } from "@/lib/types";
import {
  contratacaoStatusLabel,
  tipoContratacaoLabel,
} from "@/lib/types";

export type ContratacaoRow = {
  id: string;
  nome: string;
  cargo: string;
  tipo_contratacao: TipoContratacao;
  status: ContratacaoStatus;
  created_at: string;
  empresa_nome: string | null;
  regional_nome: string | null;
};

const TODAS = "__todas__";

/** Cor do chip por status. */
function corStatus(status: ContratacaoStatus): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground";
    case "proposta_enviada":
    case "aceite_recebido":
    case "dados_completos":
    case "contrato_gerado":
    case "contrato_assinado":
      return "bg-amber-50 text-amber-800";
    case "efetivada":
      return "bg-emerald-50 text-emerald-700";
    case "recusada":
    case "desistiu":
    case "expirada":
      return "bg-california-red/10 text-california-red";
  }
}

const STATUS_ANDAMENTO: ContratacaoStatus[] = [
  "rascunho",
  "proposta_enviada",
  "aceite_recebido",
  "dados_completos",
  "contrato_gerado",
  "contrato_assinado",
];

type StatusFiltro = "andamento" | "finalizadas" | "canceladas" | "todas";

export function ContratacoesList({
  contratacoes,
}: {
  contratacoes: ContratacaoRow[];
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [statusFiltro, setStatusFiltro] =
    React.useState<StatusFiltro>("andamento");

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return contratacoes.filter((c) => {
      if (statusFiltro === "andamento" && !STATUS_ANDAMENTO.includes(c.status))
        return false;
      if (statusFiltro === "finalizadas" && c.status !== "efetivada")
        return false;
      if (
        statusFiltro === "canceladas" &&
        !["recusada", "desistiu", "expirada"].includes(c.status)
      )
        return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.cargo.toLowerCase().includes(q) ||
        (c.empresa_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [contratacoes, busca, statusFiltro]);

  const contagemAndamento = contratacoes.filter((c) =>
    STATUS_ANDAMENTO.includes(c.status),
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, cargo ou empresa..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFiltro}
          onValueChange={(v) => setStatusFiltro(v as StatusFiltro)}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="bottom" avoidCollisions={false}>
            <SelectItem value="andamento">
              Em andamento{contagemAndamento > 0 && ` (${contagemAndamento})`}
            </SelectItem>
            <SelectItem value="finalizadas">Efetivadas</SelectItem>
            <SelectItem value="canceladas">
              Canceladas (recusa/desistência/expiração)
            </SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Link
            href="/rh/contratacoes/nova"
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
          >
            <Plus className="h-4 w-4" />
            Nova contratação
          </Link>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma contratação corresponde aos filtros.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Candidato
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Cargo
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Alocação
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-28">
                  Contrato
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-48">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Dias
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const dias = Math.max(
                  0,
                  Math.floor(
                    (Date.now() - new Date(c.created_at).getTime()) /
                      (1000 * 60 * 60 * 24),
                  ),
                );
                const alerta =
                  STATUS_ANDAMENTO.includes(c.status) && dias > 7;
                return (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/rh/contratacoes/${c.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/rh/contratacoes/${c.id}`);
                      }
                    }}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/rh/contratacoes/${c.id}`}
                        prefetch={false}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-california-red transition-colors"
                      >
                        {c.nome}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.cargo}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.empresa_nome
                        ? `${c.empresa_nome}${c.regional_nome ? ` · ${c.regional_nome}` : ""}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {tipoContratacaoLabel(c.tipo_contratacao)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(c.status)}`}
                      >
                        {contratacaoStatusLabel(c.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span
                        className={`inline-flex items-center gap-1 ${alerta ? "text-california-red font-medium" : ""}`}
                      >
                        {alerta && <Clock className="h-3 w-3" />}
                        {dias} {dias === 1 ? "dia" : "dias"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
