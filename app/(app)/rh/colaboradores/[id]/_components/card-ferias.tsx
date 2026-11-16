import Link from "next/link";
import { Palmtree, ArrowRight, Clock } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { FeriasPeriodoStatus } from "@/lib/types";

export interface FeriasPeriodoResumo {
  id: string;
  numero: number;
  aquisitivo_inicio: string;
  aquisitivo_fim: string;
  concessivo_fim: string;
  status: FeriasPeriodoStatus;
  dias_restantes: number;
}

const STATUS_STYLE: Record<
  FeriasPeriodoStatus,
  { label: string; dot: string; chip: string }
> = {
  incompleto: {
    label: "Incompleto",
    dot: "bg-slate-400",
    chip: "bg-slate-50 text-slate-700 border-slate-200",
  },
  apto: {
    label: "Apto",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  em_alerta: {
    label: "Em alerta",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
  },
  vencido: {
    label: "Vencido",
    dot: "bg-red-500",
    chip: "bg-red-50 text-red-700 border-red-200",
  },
  regularizado: {
    label: "Regularizado",
    dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
  },
  nao_habilitado: {
    label: "Não habilitado",
    dot: "bg-slate-300",
    chip: "bg-slate-50 text-slate-500 border-slate-200",
  },
  pago_rescisao: {
    label: "Pago em rescisão",
    dot: "bg-slate-500",
    chip: "bg-slate-50 text-slate-700 border-slate-200",
  },
};

const STATUS_ATIVOS: FeriasPeriodoStatus[] = ["apto", "em_alerta", "vencido"];
const STATUS_HISTORICO: FeriasPeriodoStatus[] = [
  "regularizado",
  "pago_rescisao",
];

interface Props {
  colaboradorId: string;
  periodos: FeriasPeriodoResumo[];
  diasDisponiveis: number;
}

export function CardFerias({
  colaboradorId,
  periodos,
  diasDisponiveis,
}: Props) {
  const ativos = periodos
    .filter((p) => STATUS_ATIVOS.includes(p.status))
    .sort((a, b) => a.numero - b.numero);
  const historicos = periodos
    .filter((p) => STATUS_HISTORICO.includes(p.status))
    .sort((a, b) => b.numero - a.numero);

  const temAlgumaCoisa = ativos.length > 0 || historicos.length > 0;

  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
            <Palmtree className="h-3.5 w-3.5" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
            Férias
          </h3>
        </div>
        <Link
          href={`/rh/ferias/${colaboradorId}`}
          prefetch={false}
          className="inline-flex items-center gap-1 text-xs font-medium text-california-red hover:underline"
        >
          Ver detalhes <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {!temAlgumaCoisa ? (
        <p className="text-sm text-muted-foreground">
          Nenhum período aquisitivo ativo. Novos períodos aparecem quando o
          colaborador completa 1 ano de admissão.
        </p>
      ) : (
        <>
          <div className="mb-4 rounded-lg bg-muted/40 px-3 py-2 flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Saldo disponível
            </span>
            <span className="text-lg font-bold tabular-nums text-foreground">
              {diasDisponiveis}
            </span>
            <span className="text-xs text-muted-foreground">
              dia{diasDisponiveis === 1 ? "" : "s"}
            </span>
          </div>

          {ativos.length > 0 && (
            <ul className="space-y-2 mb-4">
              {ativos.map((p) => (
                <AquisitivoAtivo key={p.id} periodo={p} />
              ))}
            </ul>
          )}

          {historicos.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Histórico
              </p>
              <ul className="space-y-1.5">
                {historicos.map((p) => (
                  <AquisitivoHistorico key={p.id} periodo={p} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AquisitivoAtivo({ periodo: p }: { periodo: FeriasPeriodoResumo }) {
  const style = STATUS_STYLE[p.status];
  const vencido = p.status === "vencido";
  return (
    <li
      className={cn(
        "rounded-xl border-2 px-4 py-3",
        vencido
          ? "border-red-300 bg-red-50/60"
          : "border-california-red/40 bg-california-red/5",
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white",
                vencido ? "bg-red-500" : "bg-california-red",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              {vencido ? "Vencido" : "Atual"}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                style.chip,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
              {style.label}
            </span>
          </div>
          <p className="text-sm font-semibold text-foreground">
            Aquisitivo #{p.numero}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {formatDate(p.aquisitivo_inicio)} → {formatDate(p.aquisitivo_fim)}
          </p>
        </div>
        {!vencido && p.dias_restantes >= 0 && (
          <div className="text-right shrink-0">
            <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              <Clock className="h-3 w-3" />
              Vence em
            </div>
            <p className="text-sm font-bold tabular-nums text-foreground">
              {p.dias_restantes}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                dia{p.dias_restantes === 1 ? "" : "s"}
              </span>
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

function AquisitivoHistorico({
  periodo: p,
}: {
  periodo: FeriasPeriodoResumo;
}) {
  const style = STATUS_STYLE[p.status];
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-1.5">
      <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-medium text-foreground">
          Aquisitivo #{p.numero}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatDate(p.aquisitivo_inicio)} → {formatDate(p.aquisitivo_fim)}
        </span>
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0",
          style.chip,
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
        {style.label}
      </span>
    </li>
  );
}
