"use client";

import * as React from "react";
import {
  Briefcase,
  Calendar,
  Clock,
  Building2,
  MapPin,
  Mail,
  Eye,
  EyeOff,
} from "lucide-react";
import type { TipoContratacao } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import { cn, initials, formatDate, formatCurrency } from "@/lib/utils";

type Props = {
  nome: string;
  tipo_contratacao: TipoContratacao;
  funcao: string | null;
  data_admissao: string | null;
  email: string | null;
  status: string;
  saldoDias: number;
  salario: number | null;
  empresa: string | null;
  regional: string | null;
  botaoLancar: React.ReactNode;
};

/**
 * Hero inspirado no /freelancers/[id]: dark gradient com blur, avatar
 * de iniciais, nome em destaque, chips de metadados e ações à direita.
 * Adaptado pra férias: saldo disponível é o número grande (no freela
 * é o valor do contrato).
 */
export function HeroColaboradorFerias({
  nome,
  tipo_contratacao,
  funcao,
  data_admissao,
  email,
  status,
  saldoDias,
  salario,
  empresa,
  regional,
  botaoLancar,
}: Props) {
  const [salarioVisivel, setSalarioVisivel] = React.useState(false);
  const avatarIniciais = initials(nome);
  const ativo = status === "ativo";
  const regimeLabel = tipoContratacaoLabel(tipo_contratacao).split(" ")[0];

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
            {avatarIniciais}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-balance text-white">
              {nome}
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
                {ativo ? "Ativo" : status}
              </span>
              <span className="inline-flex items-center rounded-full bg-white/10 border border-white/20 text-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                {regimeLabel}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {funcao && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <Briefcase className="h-3 w-3" />
                  {funcao}
                </span>
              )}
              {data_admissao && (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                    <Calendar className="h-3 w-3" />
                    Admissão {formatDate(data_admissao)}
                  </span>
                  {ativo && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                      <Clock className="h-3 w-3" />
                      Há {tempoDesde(data_admissao)}
                    </span>
                  )}
                </>
              )}
              {empresa && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <Building2 className="h-3 w-3" />
                  {empresa}
                </span>
              )}
              {regional && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                  <MapPin className="h-3 w-3" />
                  {regional}
                </span>
              )}
              {email && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white/80">
                  <Mail className="h-3 w-3" />
                  {email}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Saldo disponível
            </p>
            <p className="mt-0.5 text-3xl md:text-4xl font-bold tabular-nums text-white leading-none">
              {saldoDias}
              <span className="text-sm font-medium text-white/60 ml-1">
                dias
              </span>
            </p>
            {salario !== null && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70">
                <span className="tabular-nums select-none">
                  {salarioVisivel
                    ? formatCurrency(salario)
                    : "R$ ••••••"}
                </span>
                <button
                  type="button"
                  onClick={() => setSalarioVisivel((v) => !v)}
                  className="p-0.5 rounded hover:text-white transition-colors"
                  aria-label={salarioVisivel ? "Ocultar salário" : "Mostrar salário"}
                  title={salarioVisivel ? "Ocultar salário" : "Mostrar salário"}
                >
                  {salarioVisivel ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">{botaoLancar}</div>
        </div>
      </div>
    </header>
  );
}

function tempoDesde(iso: string): string {
  const inicio = new Date(iso + "T00:00:00").getTime();
  const agora = Date.now();
  const dias = Math.floor((agora - inicio) / 86_400_000);
  if (dias < 0) return "—";
  if (dias < 30) return `${dias} ${dias === 1 ? "dia" : "dias"}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  const mesesRest = meses % 12;
  return mesesRest > 0
    ? `${anos}a ${mesesRest}m`
    : `${anos} ${anos === 1 ? "ano" : "anos"}`;
}
