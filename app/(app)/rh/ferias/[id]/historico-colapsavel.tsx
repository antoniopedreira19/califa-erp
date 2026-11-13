"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import type {
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";

type Lanc = {
  id: string;
  tipo: FeriasLancamentoTipo;
  dias: number;
  dias_abono: number;
  data_inicio: string;
  data_fim: string;
  status: FeriasLancamentoStatus;
  observacao: string | null;
  lancado_direto_por_rh: boolean;
  valor_total: number | null;
};

type Props = {
  lancamentos: Lanc[];
  tipoContratacao: TipoContratacao;
};

/**
 * Histórico de lançamentos de férias — colapsado por padrão pra não
 * poluir a página. Clica no cabeçalho pra expandir. Lista em ordem
 * cronológica decrescente.
 */
export function HistoricoColapsavel({ lancamentos }: Props) {
  const [aberto, setAberto] = React.useState(false);
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
          <History className="h-4 w-4 text-california-red" />
          Histórico de lançamentos
        </span>
        <span className="inline-flex items-center justify-center min-w-[24px] rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {lancamentos.length}
        </span>
      </button>

      {aberto && (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-white shadow-soft overflow-hidden">
          {lancamentos.map((l) => (
            <LinhaLancamento key={l.id} lanc={l} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinhaLancamento({ lanc: l }: { lanc: Lanc }) {
  const diasFolga = l.dias - (l.dias_abono ?? 0);
  const inicio = new Date(l.data_inicio + "T00:00:00").toLocaleDateString(
    "pt-BR",
  );
  const fim = new Date(l.data_fim + "T00:00:00").toLocaleDateString("pt-BR");
  const valorFmt = l.valor_total
    ? l.valor_total.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })
    : null;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {inicio} a {fim} · {l.dias} dia{l.dias === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tipoLabel(l.tipo)}
            {l.dias_abono > 0 && (
              <>
                {" "}
                · {diasFolga} folga + {l.dias_abono} abono
              </>
            )}
            {l.lancado_direto_por_rh && <> · lançado pelo RH</>}
          </p>
          {l.observacao && (
            <p className="text-xs text-muted-foreground italic mt-1">
              &ldquo;{l.observacao}&rdquo;
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-right">
          <BadgeStatus status={l.status} />
          {valorFmt && (
            <span className="text-xs text-muted-foreground font-mono">
              {valorFmt}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function tipoLabel(t: FeriasLancamentoTipo): string {
  if (t === "usufruto") return "Férias (dias de folga)";
  if (t === "abono_combinado") return "Férias + abono combinado";
  if (t === "abono_avulso") return "Abono avulso";
  if (t === "abono_excepcional") return "Abono excepcional";
  return t;
}

function BadgeStatus({ status }: { status: FeriasLancamentoStatus }) {
  const map: Record<
    FeriasLancamentoStatus,
    { label: string; cls: string }
  > = {
    pendente_aprovacao: {
      label: "Pendente",
      cls: "bg-amber-100 text-amber-900",
    },
    aguardando_financeiro: {
      label: "Ag. financeiro",
      cls: "bg-purple-100 text-purple-800",
    },
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-800" },
    reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-800" },
    cancelado: {
      label: "Cancelado",
      cls: "bg-muted text-muted-foreground",
    },
    concluido: { label: "Concluído", cls: "bg-slate-200 text-slate-700" },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}
    >
      {info.label}
    </span>
  );
}
