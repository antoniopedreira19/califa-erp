"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  Search,
  X,
  ArrowRight,
  MessageCircle,
} from "lucide-react";
import { cn, formatCurrency, formatCpf } from "@/lib/utils";
import type {
  FreelancerSolicitacao,
  FreelancerSolicitacaoStatus,
} from "@/lib/types";
import {
  ChipStatusSolicitacao,
  STATUS_SOLICITACAO,
} from "./chip-status-solicitacao";
import { PopoverSolicitacao } from "./popover-solicitacao";

interface SolicitacaoLinha extends FreelancerSolicitacao {
  solicitante_nome: string | null;
  solicitante_email: string | null;
  job_codigo: string | null;
  job_nome: string | null;
}

interface Props {
  solicitacoes: SolicitacaoLinha[];
  activeRole: string;
  userId: string;
  publicOrigin: string;
  naoLidasPorSolicitacao: Record<string, number>;
  actions?: React.ReactNode;
}

export function SolicitacoesTabela({
  solicitacoes,
  activeRole,
  userId,
  publicOrigin,
  naoLidasPorSolicitacao,
  actions,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busca, setBusca] = React.useState(searchParams.get("q") ?? "");
  const [selecionada, setSelecionada] =
    React.useState<SolicitacaoLinha | null>(null);
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  React.useEffect(() => {
    setBusca(searchParams.get("q") ?? "");
  }, [searchParams]);

  const statusAtivos = React.useMemo(() => {
    const raw = searchParams.get("status");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  function alterarQueryString(fn: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    fn(params);
    const qs = params.toString();
    router.push(`/freelancers/solicitacoes${qs ? `?${qs}` : ""}`);
  }

  function toggleStatus(v: FreelancerSolicitacaoStatus) {
    const nova = new Set(statusAtivos);
    if (nova.has(v)) nova.delete(v);
    else nova.add(v);
    alterarQueryString((p) => {
      if (nova.size > 0) p.set("status", Array.from(nova).join(","));
      else p.delete("status");
    });
  }

  function submitBusca(e: React.FormEvent) {
    e.preventDefault();
    alterarQueryString((p) => {
      const t = busca.trim();
      if (t) p.set("q", t);
      else p.delete("q");
    });
  }

  function limparBusca() {
    setBusca("");
    alterarQueryString((p) => p.delete("q"));
  }

  function abrir(s: SolicitacaoLinha) {
    setSelecionada(s);
    setPopoverOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Busca + ações */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <form onSubmit={submitBusca} className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou CPF do freela..."
            className="w-full h-10 rounded-lg border border-border bg-white pl-10 pr-9 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15"
          />
          {busca && (
            <button
              type="button"
              onClick={limparBusca}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>
        {actions && (
          <div className="flex items-center gap-2 md:shrink-0">{actions}</div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">
            Status
          </span>
          {STATUS_SOLICITACAO.map((s) => {
            const ativo = statusAtivos.has(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleStatus(s.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all border",
                  ativo
                    ? "bg-california-dark text-white border-california-dark"
                    : "bg-white text-foreground border-border hover:border-california-red/40",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabela */}
      {solicitacoes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Nenhuma solicitação encontrada
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajuste os filtros ou crie uma nova solicitação.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          <table className="w-full text-xs">
            <thead className="bg-muted/20 border-b border-border">
              <tr>
                <Th>Freelancer</Th>
                <Th>Job</Th>
                <Th>Cargo</Th>
                <Th className="text-right">Valor</Th>
                <Th>Solicitante</Th>
                <Th className="text-center">Data</Th>
                <Th className="text-center">Status</Th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {solicitacoes.map((s) => (
                <SolicitacaoRow
                  key={s.id}
                  s={s}
                  naoLidas={naoLidasPorSolicitacao[s.id] ?? 0}
                  onAbrir={() => abrir(s)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PopoverSolicitacao
        solicitacao={selecionada}
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        activeRole={activeRole}
        userId={userId}
        publicOrigin={publicOrigin}
      />
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]",
        className,
      )}
    >
      {children}
    </th>
  );
}

function SolicitacaoRow({
  s,
  naoLidas,
  onAbrir,
}: {
  s: SolicitacaoLinha;
  naoLidas: number;
  onAbrir: () => void;
}) {
  return (
    <tr
      onClick={onAbrir}
      className="border-b border-border last:border-0 hover:bg-california-red/[0.02] transition-colors group cursor-pointer"
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {naoLidas > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-california-red px-1.5 py-0.5 text-[9px] font-bold text-white"
              title={`${naoLidas} mensagem(ns) não lida(s)`}
            >
              <MessageCircle className="h-2.5 w-2.5" />
              {naoLidas}
            </span>
          )}
          <p className="font-semibold text-foreground uppercase tracking-wide">
            {s.nome_freela}
          </p>
        </div>
        {s.cpf_freela && (
          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            {formatCpf(s.cpf_freela)}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <p className="text-foreground">
          {s.job_codigo && (
            <span className="text-muted-foreground tabular-nums mr-1">
              {s.job_codigo}
            </span>
          )}
          {s.job_nome ?? "—"}
        </p>
      </td>
      <td className="px-3 py-2.5 text-foreground">
        {s.cargo || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {formatCurrency(Number(s.valor))}
        <span className="text-[10px] text-muted-foreground"> /{s.tipo}</span>
      </td>
      <td className="px-3 py-2.5 text-foreground truncate max-w-[160px]">
        {s.solicitante_nome ?? "—"}
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
        {new Date(s.created_at).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        })}
      </td>
      <td className="px-3 py-2.5 text-center">
        <ChipStatusSolicitacao
          status={s.status as FreelancerSolicitacaoStatus}
        />
      </td>
      <td className="px-2 py-2.5 text-right">
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground inline-block" />
      </td>
    </tr>
  );
}
