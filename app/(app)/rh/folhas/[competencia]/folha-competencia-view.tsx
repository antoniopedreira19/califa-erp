"use client";

import * as React from "react";
import { Search, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  Empresa,
  FolhaLinhaStatus,
  TipoContratacao,
} from "@/lib/types";
import { folhaLinhaStatusLabel } from "@/lib/types";
import { EditarLinhaFolhaDrawer } from "./editar-linha-folha-drawer";

export type FolhaLinha = {
  id: string;
  salario_base: string;
  status: FolhaLinhaStatus;
  motivo_pendencia: string | null;
  colaborador: {
    id: string;
    nome: string;
    funcao: string;
    tipo_contratacao: TipoContratacao;
    nivel_codigo: string | null;
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

export type ContagemStatus = Record<FolhaLinhaStatus, number>;

type StatusFiltro = "todos" | FolhaLinhaStatus;
const SENTINEL_TODAS_REGIONAIS = "__todas__";

const TABS: Array<{ key: StatusFiltro; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "rascunho", label: "Rascunho" },
  { key: "enviada", label: "Enviada" },
  { key: "pendente_correcao", label: "Pendente" },
  { key: "aprovada", label: "Aprovada" },
  { key: "paga", label: "Paga" },
];

export function FolhaCompetenciaView({
  linhas,
  empresas: _empresas,
  regionais,
  contagem,
  podeEditar,
}: {
  linhas: FolhaLinha[];
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  contagem: ContagemStatus;
  podeEditar: boolean;
}) {
  const [busca, setBusca] = React.useState("");
  const [tab, setTab] = React.useState<StatusFiltro>("todos");
  const [regionalId, setRegionalId] = React.useState<string>(
    SENTINEL_TODAS_REGIONAIS,
  );
  const [linhaEditando, setLinhaEditando] = React.useState<FolhaLinha | null>(
    null,
  );

  const filtradas = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (tab !== "todos" && l.status !== tab) return false;
      if (
        regionalId !== SENTINEL_TODAS_REGIONAIS &&
        !l.alocacoes.some((a) => a.regional_id === regionalId)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        l.colaborador.nome.toLowerCase().includes(q) ||
        l.colaborador.funcao.toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, tab, regionalId]);

  const contagemPorTab: Record<StatusFiltro, number> = {
    todos: linhas.length,
    rascunho: contagem.rascunho,
    enviada: contagem.enviada,
    aprovada: contagem.aprovada,
    pendente_correcao: contagem.pendente_correcao,
    paga: contagem.paga,
  };

  if (linhas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma linha nesta competência.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Filtrar por status"
        className="flex items-center gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
            count={contagemPorTab[t.key]}
            tomBadge={
              t.key === "pendente_correcao" && contagemPorTab[t.key] > 0
                ? "vermelho"
                : t.key === "paga" && contagemPorTab[t.key] > 0
                  ? "verde"
                  : undefined
            }
          >
            {t.label}
          </TabButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou função..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={regionalId}
          onValueChange={(v) => setRegionalId(v)}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SENTINEL_TODAS_REGIONAIS}>
              Todas as regionais
            </SelectItem>
            {regionais.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          Mostrando {filtradas.length} de {linhas.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Colaborador
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Alocação
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-40">
                Valor
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr
                key={l.id}
                onClick={() => setLinhaEditando(l)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLinhaEditando(l);
                  }
                }}
                className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{l.colaborador.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.colaborador.funcao}
                    {l.colaborador.nivel_codigo
                      ? ` · ${l.colaborador.nivel_codigo}`
                      : ""}
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
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhuma linha corresponde aos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {linhaEditando && (
        <EditarLinhaFolhaDrawer
          linha={linhaEditando}
          empresas={_empresas}
          regionais={regionais}
          podeEditar={podeEditar}
          open={!!linhaEditando}
          onOpenChange={(next) => {
            if (!next) setLinhaEditando(null);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  tomBadge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  tomBadge?: "vermelho" | "verde";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            active
              ? "bg-california-red text-white"
              : tomBadge === "vermelho"
                ? "bg-california-red/10 text-california-red"
                : tomBadge === "verde"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
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
