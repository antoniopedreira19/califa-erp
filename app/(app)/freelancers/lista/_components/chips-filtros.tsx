"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  STATUS_FILTRAVEIS,
  STATUS_LABEL,
} from "../../_components/status-badge";
import { ACOES_PREVISTAS } from "./acao-prevista-badge";

/**
 * Três grupos de chips de filtro:
 * - Status do trabalho (status_real): Trabalhando / Inativo → ?trabalho=
 * - Status do contrato (status_calculado): Todos + 8 estados → ?status=
 * - Decisões futuras (acao_prevista): 5 ações + Sem decisão → ?acao=
 */

const TRABALHO_CHIPS: Array<{
  value: string;
  label: string;
  variant: "success" | "neutral";
}> = [
  { value: "trabalhando", label: "Trabalhando", variant: "success" },
  { value: "inativo", label: "Inativo", variant: "neutral" },
];

const VARIANT_DOT = {
  success: "bg-emerald-500",
  danger: "bg-california-red",
  warning: "bg-amber-500",
  info: "bg-sky-500",
  violet: "bg-violet-500",
  neutral: "bg-zinc-400",
  muted: "bg-muted-foreground/60",
  default: "",
} as const;

type Variant = keyof typeof VARIANT_DOT;

const STATUS_VARIANT: Record<string, Variant> = {
  regular: "success",
  vencendo: "warning",
  irregular: "danger",
  sem_minuta: "danger",
  sem_assinado: "danger",
  agendado: "violet",
  pendente: "info",
  encerrado: "neutral",
  limbo: "neutral",
};

const ACAO_VARIANT: Record<string, Variant> = {
  contratar: "default",
  renovar: "success",
  manter: "violet",
  substituir: "warning",
  encerrar: "danger",
  sem_decisao: "muted",
};

export function ChipsFiltros() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const trabalhoAtual = searchParams.get("trabalho") ?? "";

  const statusAtivos = React.useMemo(() => {
    const raw = searchParams.get("status");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  const acoesAtivas = React.useMemo(() => {
    const raw = searchParams.get("acao");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  function alterar(fn: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    fn(params);
    const qs = params.toString();
    router.push(`/freelancers/lista${qs ? `?${qs}` : ""}`);
  }

  function toggleTrabalho(v: string) {
    alterar((p) => {
      if (trabalhoAtual === v) p.delete("trabalho");
      else p.set("trabalho", v);
    });
  }

  function toggleStatus(v: string) {
    const nova = new Set(statusAtivos);
    if (nova.has(v)) nova.delete(v);
    else nova.add(v);
    alterar((p) => {
      if (nova.size > 0) p.set("status", Array.from(nova).join(","));
      else p.delete("status");
    });
  }

  function toggleAcao(v: string) {
    const nova = new Set(acoesAtivas);
    if (nova.has(v)) nova.delete(v);
    else nova.add(v);
    alterar((p) => {
      if (nova.size > 0) p.set("acao", Array.from(nova).join(","));
      else p.delete("acao");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <FilterGroup label="Status do trabalho">
        {TRABALHO_CHIPS.map((c) => (
          <Chip
            key={c.value}
            active={trabalhoAtual === c.value}
            onClick={() => toggleTrabalho(c.value)}
            variant={c.variant}
          >
            {c.label}
          </Chip>
        ))}
      </FilterGroup>

      <FilterGroup label="Status do contrato">
        <Chip
          active={statusAtivos.size === 0}
          onClick={() =>
            alterar((p) => {
              p.delete("status");
            })
          }
          variant="default"
        >
          Todos
        </Chip>
        {STATUS_FILTRAVEIS.map((s) => (
          <Chip
            key={s}
            active={statusAtivos.has(s)}
            onClick={() => toggleStatus(s)}
            variant={STATUS_VARIANT[s] ?? "default"}
          >
            {STATUS_LABEL[s]}
          </Chip>
        ))}
      </FilterGroup>

      <FilterGroup label="Decisões futuras">
        {ACOES_PREVISTAS.map((a) => (
          <Chip
            key={a.value}
            active={acoesAtivas.has(a.value)}
            onClick={() => toggleAcao(a.value)}
            variant={ACAO_VARIANT[a.value] ?? "default"}
          >
            {a.label}
          </Chip>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground shrink-0 w-40 pt-1.5">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  variant = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: Variant;
}) {
  const dot = VARIANT_DOT[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all border",
        active
          ? "bg-california-dark text-white border-california-dark"
          : "bg-white text-foreground border-border hover:border-california-red/40",
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
      {children}
    </button>
  );
}
