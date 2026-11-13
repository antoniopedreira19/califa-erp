"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  CalendarRange,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Clock,
} from "lucide-react";
import type {
  ColaboradorFeriasPeriodo,
  FeriasPeriodoStatus,
} from "@/lib/types";

type Props = {
  periodos: Array<
    ColaboradorFeriasPeriodo & { saldo: number; diasUsados: number }
  >;
};

/**
 * Lista colapsável dos aquisitivos "não fechados" do colaborador:
 * aquisitivo em curso, aptos, em alerta, vencidos. Serve pro RH
 * entender de onde o colaborador pode tirar férias sem precisar
 * consultar a planilha. Fica colapsado por padrão pra não poluir
 * a página — o que importa de cara é a situação atual.
 */
export function PeriodosDisponiveisColapsavel({ periodos }: Props) {
  const [aberto, setAberto] = React.useState(false);

  // Ordenação: mais crítico primeiro (vencido > alerta > apto > em curso).
  const ordem: Record<FeriasPeriodoStatus, number> = {
    vencido: 1,
    em_alerta: 2,
    apto: 3,
    incompleto: 4,
    regularizado: 9,
    nao_habilitado: 9,
    pago_rescisao: 9,
  };
  const ordenados = [...periodos].sort(
    (a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9),
  );

  return (
    <section>
      <button
        type="button"
        onClick={() => setAberto((x) => !x)}
        aria-expanded={aberto}
        className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3 text-sm hover:bg-muted/30 transition-colors shadow-soft"
      >
        <span className="flex items-center gap-2 font-medium">
          {aberto ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <CalendarRange className="h-4 w-4 text-california-red" />
          Períodos disponíveis
        </span>
        <span className="inline-flex items-center justify-center min-w-[24px] rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {periodos.length}
        </span>
      </button>

      {aberto && (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-white shadow-soft overflow-hidden">
          {ordenados.map((p) => (
            <LinhaPeriodo key={p.id} periodo={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinhaPeriodo({
  periodo: p,
}: {
  periodo: ColaboradorFeriasPeriodo & { saldo: number; diasUsados: number };
}) {
  const rotulo = `${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`;
  const limiteFmt = new Date(
    p.data_limite_gozo + "T00:00:00",
  ).toLocaleDateString("pt-BR");
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(p.data_limite_gozo + "T00:00:00");
  const dif = Math.ceil((limite.getTime() - hoje.getTime()) / 86_400_000);

  const info: Record<
    FeriasPeriodoStatus,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    vencido: {
      label: "Vencido",
      cls: "bg-red-100 text-red-800",
      icon: <AlertOctagon className="h-4 w-4 text-red-700" />,
    },
    em_alerta: {
      label: "Vence em breve",
      cls: "bg-amber-100 text-amber-900",
      icon: <AlertTriangle className="h-4 w-4 text-amber-700" />,
    },
    apto: {
      label: "Apto",
      cls: "bg-emerald-100 text-emerald-800",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-700" />,
    },
    incompleto: {
      label: "Em curso",
      cls: "bg-muted text-muted-foreground",
      icon: <Clock className="h-4 w-4 text-muted-foreground" />,
    },
    regularizado: {
      label: "Regularizado",
      cls: "bg-sky-100 text-sky-800",
      icon: <CheckCircle2 className="h-4 w-4 text-sky-700" />,
    },
    nao_habilitado: {
      label: "Não habilitado",
      cls: "bg-muted text-muted-foreground",
      icon: <Clock className="h-4 w-4 text-muted-foreground" />,
    },
    pago_rescisao: {
      label: "Pago rescisão",
      cls: "bg-slate-200 text-slate-700",
      icon: <CheckCircle2 className="h-4 w-4 text-slate-600" />,
    },
  };
  const i = info[p.status];

  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="shrink-0">{i.icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Aquisitivo {rotulo}</p>
        <p className="text-xs text-muted-foreground">
          Limite {limiteFmt}
          {" · "}
          {dif > 0 ? `vence em ${dif}d` : `venceu há ${-dif}d`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold tabular-nums">
          {p.saldo}
          <span className="text-xs font-normal text-muted-foreground">
            /{p.dias_direito}d
          </span>
        </p>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium mt-1 ${i.cls}`}
        >
          {i.label}
        </span>
      </div>
    </li>
  );
}
