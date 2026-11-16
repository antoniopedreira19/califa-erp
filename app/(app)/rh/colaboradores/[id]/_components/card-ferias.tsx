import Link from "next/link";
import { Palmtree, ArrowRight } from "lucide-react";
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
  const temPeriodos = periodos.length > 0;

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

      {!temPeriodos ? (
        <p className="text-sm text-muted-foreground">
          Nenhum período aquisitivo gerado. Verifique a data de admissão.
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

          <ul className="space-y-2">
            {periodos.map((p) => {
              const style = STATUS_STYLE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      Aquisitivo #{p.numero}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {formatDate(p.aquisitivo_inicio)} →{" "}
                      {formatDate(p.aquisitivo_fim)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(p.status === "apto" || p.status === "em_alerta") &&
                      p.dias_restantes >= 0 && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold tabular-nums">
                          {p.dias_restantes}d p/ vencer
                        </span>
                      )}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        style.chip,
                      )}
                    >
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                      />
                      {style.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
