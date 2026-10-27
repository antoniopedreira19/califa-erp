"use client";

import * as React from "react";
import Link from "next/link";
import {
  Edit2,
  Plus,
  Calendar,
  Clock,
  Briefcase,
  MapPin,
  User,
  Eye,
  EyeOff,
} from "lucide-react";
import type {
  Freelancer,
  TipoFreelancerContrato,
  AcaoPrevistaFreelancer,
} from "@/lib/types";
import { cn, formatCurrency, initials, formatDate } from "@/lib/utils";

const TIPO_LABEL: Record<TipoFreelancerContrato, string> = {
  mensal: "Mensal",
  periodo: "Período",
  diarias: "Diárias",
};

const ACAO_META: Record<
  AcaoPrevistaFreelancer,
  { label: string; dot: string; text: string; bg: string; border: string }
> = {
  contratar: {
    label: "Ação: Contratar",
    dot: "bg-sky-400",
    text: "text-sky-100",
    bg: "bg-sky-500/15",
    border: "border-sky-500/40",
  },
  renovar: {
    label: "Ação: Renovar",
    dot: "bg-emerald-400",
    text: "text-emerald-100",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/40",
  },
  manter: {
    label: "Ação: Manter",
    dot: "bg-violet-400",
    text: "text-violet-100",
    bg: "bg-violet-500/15",
    border: "border-violet-500/40",
  },
  substituir: {
    label: "Ação: Substituir",
    dot: "bg-amber-400",
    text: "text-amber-100",
    bg: "bg-amber-500/15",
    border: "border-amber-500/40",
  },
  encerrar: {
    label: "Ação: Encerrar",
    dot: "bg-california-red",
    text: "text-rose-100",
    bg: "bg-california-red/15",
    border: "border-california-red/40",
  },
};

export interface HeroContratoAtual {
  valor: number | string | null;
  tipo: TipoFreelancerContrato | null;
  data_inicio: string | null;
  data_termino: string | null;
  cidade: string | null;
  cargo: string | null;
  responsavel_nome: string | null;
  status_real: boolean;
}

interface Props {
  freelancer: Freelancer;
  podeEditar: boolean;
  /** Contrato "atual" (vigente hoje) — alimenta período, cargo, cidade, valor, responsável. */
  contratoAtual?: HeroContratoAtual | null;
}

export function HeroFreelancer({
  freelancer: f,
  podeEditar,
  contratoAtual,
}: Props) {
  const [valorVisivel, setValorVisivel] = React.useState(false);
  const avatarIniciais = initials(f.nome_social);
  const acaoMeta = f.acao_prevista
    ? ACAO_META[f.acao_prevista as AcaoPrevistaFreelancer]
    : null;

  const trabalhando = contratoAtual?.status_real === true;
  const valorNum =
    contratoAtual?.valor != null ? Number(contratoAtual.valor) : null;

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
              {f.nome_completo || f.nome_social}
            </h1>
            {f.nome_completo &&
              f.nome_social &&
              f.nome_completo !== f.nome_social && (
                <p className="text-sm text-white/60 mt-0.5">{f.nome_social}</p>
              )}

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {contratoAtual && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                    trabalhando
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-100"
                      : "bg-white/10 border-white/20 text-white/70",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      trabalhando ? "bg-emerald-400" : "bg-white/40",
                    )}
                  />
                  {trabalhando ? "Trabalhando" : "Encerrado"}
                </span>
              )}
              {acaoMeta && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                    acaoMeta.bg,
                    acaoMeta.border,
                    acaoMeta.text,
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", acaoMeta.dot)}
                  />
                  {acaoMeta.label}
                </span>
              )}
              {f.origem === "migracao" && (
                <span className="inline-flex items-center rounded-full bg-white/10 border border-white/20 text-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                  Migrado
                </span>
              )}
            </div>

            {contratoAtual && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {contratoAtual.data_inicio && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                    <Calendar className="h-3 w-3" />
                    {formatDate(contratoAtual.data_inicio)}
                    {contratoAtual.data_termino && (
                      <> → {formatDate(contratoAtual.data_termino)}</>
                    )}
                  </span>
                )}
                {trabalhando && contratoAtual.data_inicio && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                    <Clock className="h-3 w-3" />
                    Trabalhando há {tempoDesde(contratoAtual.data_inicio)}
                  </span>
                )}
                {contratoAtual.cargo && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Briefcase className="h-3 w-3" />
                    {contratoAtual.cargo}
                  </span>
                )}
                {contratoAtual.cidade && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                    <MapPin className="h-3 w-3" />
                    {contratoAtual.cidade}
                  </span>
                )}
                {contratoAtual.responsavel_nome && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
                    <User className="h-3 w-3" />
                    {contratoAtual.responsavel_nome}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          {contratoAtual && valorNum !== null && (
            <div className="text-right">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                Valor atual
                <button
                  type="button"
                  onClick={() => setValorVisivel((v) => !v)}
                  className="p-0.5 rounded hover:text-white/80 transition-colors"
                  aria-label={valorVisivel ? "Ocultar valor" : "Mostrar valor"}
                  title={valorVisivel ? "Ocultar valor" : "Mostrar valor"}
                >
                  {valorVisivel ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              </div>
              <p className="mt-0.5 text-2xl md:text-3xl font-bold tabular-nums text-white select-none">
                {valorVisivel ? formatCurrency(valorNum) : "R$ ••••••"}
              </p>
              {contratoAtual.tipo && (
                <p className="text-xs text-white/60 mt-0.5">
                  {TIPO_LABEL[contratoAtual.tipo]}
                </p>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {podeEditar && (
              <>
                <Link
                  href={`/freelancers/${f.id}/editar`}
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 hover:border-white/30 transition-all"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  Editar perfil
                </Link>
                <Link
                  href={`/freelancers/contratos/novo?freelancer=${f.id}`}
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Novo contrato
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function tempoDesde(iso: string): string {
  const inicio = new Date(iso + "T00:00:00").getTime();
  const agora = Date.now();
  const dias = Math.floor((agora - inicio) / (1000 * 60 * 60 * 24));
  if (dias < 0) return "—";
  if (dias < 1) return "hoje";
  if (dias < 30) return `${dias} ${dias === 1 ? "dia" : "dias"}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  const mesesRest = meses % 12;
  return mesesRest > 0
    ? `${anos}a ${mesesRest}m`
    : `${anos} ${anos === 1 ? "ano" : "anos"}`;
}
