"use client";

import * as React from "react";
import {
  Briefcase,
  Calendar,
  MapPin,
  User,
  Layers,
  FileBadge,
} from "lucide-react";
import type { Colaborador, Nivel, TipoContratacao } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import { cn, initials, formatDate } from "@/lib/utils";

interface Props {
  colaborador: Colaborador & {
    nivel: Pick<Nivel, "id" | "codigo" | "descricao"> | null;
    lider: { id: string; nome: string } | null;
  };
  empresaPrincipal: string | null;
  regionalPrincipal: string | null;
}

export function HeroColaborador({
  colaborador: c,
  empresaPrincipal,
  regionalPrincipal,
}: Props) {
  const ativo = c.status === "ativo";
  const avatar = initials(c.nome);

  return (
    <header className="relative overflow-hidden rounded-2xl bg-california-dark text-white p-6 md:p-8 shadow-elevated">
      <div
        className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-california-red/30 blur-3xl pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute -bottom-32 -left-16 h-56 w-56 rounded-full bg-california-red/10 blur-3xl pointer-events-none"
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-6 flex-wrap md:flex-nowrap">
        <div className="flex items-start gap-5 min-w-0 flex-1">
          <div className="flex h-16 w-16 md:h-20 md:w-20 items-center justify-center rounded-2xl bg-california-red text-white text-xl md:text-2xl font-bold shadow-brand shrink-0">
            {avatar}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-balance text-white">
              {c.nome}
            </h1>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                  ativo
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-100"
                    : "bg-white/10 border-white/20 text-white/70",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    ativo ? "bg-emerald-400" : "bg-white/40",
                  )}
                />
                {ativo ? "Ativo" : "Inativo"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white uppercase tracking-wider">
                <FileBadge className="h-3 w-3" />
                {tipoContratacaoLabel(c.tipo_contratacao as TipoContratacao)}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {c.funcao && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <Briefcase className="h-3 w-3" />
                  {c.funcao}
                </span>
              )}
              {c.nivel && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <Layers className="h-3 w-3" />
                  Nível {c.nivel.codigo}
                </span>
              )}
              {empresaPrincipal && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <MapPin className="h-3 w-3" />
                  {empresaPrincipal}
                  {regionalPrincipal ? ` · ${regionalPrincipal}` : ""}
                </span>
              )}
              {c.data_admissao && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                  <Calendar className="h-3 w-3" />
                  Admissão {formatDate(c.data_admissao)}
                </span>
              )}
              {c.lider && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <User className="h-3 w-3" />
                  Líder {c.lider.nome}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
