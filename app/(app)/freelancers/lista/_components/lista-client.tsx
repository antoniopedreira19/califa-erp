"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Users } from "lucide-react";
import { cn, formatCpf } from "@/lib/utils";
import type {
  AcaoPrevistaFreelancer,
  FreelancerComStatus,
  StatusCalculado,
} from "@/lib/types";
import { AcaoPrevistaBadge, ACOES_PREVISTAS } from "./acao-prevista-badge";
import { StatusBadge } from "../../_components/status-badge";

interface Props {
  freelancers: FreelancerComStatus[];
}

export function ListaClient({ freelancers }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const acoesAtivas = React.useMemo(() => {
    const raw = searchParams.get("acao");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  function toggleAcao(valor: string) {
    const nova = new Set(acoesAtivas);
    if (nova.has(valor)) nova.delete(valor);
    else nova.add(valor);

    const params = new URLSearchParams(searchParams.toString());
    if (nova.size > 0) {
      params.set("acao", Array.from(nova).join(","));
    } else {
      params.delete("acao");
    }
    const qs = params.toString();
    router.push(`/freelancers/lista${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="space-y-4">
      {/* Chips de filtro */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">
          Ação prevista
        </span>
        {ACOES_PREVISTAS.map((a) => {
          const ativo = acoesAtivas.has(a.value);
          return (
            <button
              key={a.value}
              type="button"
              onClick={() => toggleAcao(a.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all border",
                ativo
                  ? "bg-california-dark text-white border-california-dark"
                  : "bg-white text-foreground border-border hover:border-california-red/40",
              )}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      {/* Tabela */}
      {freelancers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Nenhum freelancer encontrado
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajuste a busca ou os chips de filtro.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          <table className="w-full text-xs">
            <thead className="bg-muted/20 border-b border-border">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
                  Nome
                </th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
                  CPF
                </th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
                  Cargo
                </th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
                  Status
                </th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
                  Cidade
                </th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
                  Ação prevista
                </th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
                  Cadastrado em
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {freelancers.map((f) => (
                <FreelancerRow key={f.id} f={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FreelancerRow({ f }: { f: FreelancerComStatus }) {
  const href = `/freelancers/${f.id}`;
  const dataFormatada = new Date(f.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <tr className="border-b border-border last:border-0 hover:bg-california-red/[0.02] transition-colors group">
      <td className="px-3 py-2.5">
        <Link
          href={href}
          prefetch={false}
          className="font-semibold text-foreground uppercase tracking-wide group-hover:text-california-red transition-colors"
        >
          {f.nome_social}
        </Link>
        {f.nome_completo && f.nome_completo !== f.nome_social && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {f.nome_completo}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 tabular-nums text-foreground">
        {f.cpf ? formatCpf(f.cpf) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5 text-foreground">
        {f.cargo_contrato ? (
          f.cargo_contrato
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge status={f.status_calculado as StatusCalculado} />
      </td>
      <td className="px-3 py-2.5 text-foreground">
        {f.cidade ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5 text-center">
        <AcaoPrevistaBadge acao={f.acao_prevista as AcaoPrevistaFreelancer | null} />
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
        {dataFormatada}
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
