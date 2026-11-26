"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, History, Search, X } from "lucide-react";
import type {
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";
import { STATUS_CONSOME_SALDO } from "@/lib/ferias/status-consome-saldo";

type Lanc = {
  id: string;
  periodo_id: string | null;
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

type PeriodoResumo = {
  id: string;
  numero: number;
  aquisitivo_inicio: string;
  aquisitivo_fim: string;
  dias_direito: number;
};

type Props = {
  lancamentos: Lanc[];
  periodos: PeriodoResumo[];
  tipoContratacao: TipoContratacao;
};

type Grupo = {
  chave: string;
  titulo: string;
  periodoNumero: number | null;
  lancamentos: Lanc[];
};

function agrupar(
  lancs: Lanc[],
  periodos: PeriodoResumo[],
): Grupo[] {
  const porId = new Map(periodos.map((p) => [p.id, p]));
  const buckets = new Map<string, Grupo>();

  for (const l of lancs) {
    const chave = l.periodo_id ?? "__sem_periodo__";
    if (!buckets.has(chave)) {
      if (l.periodo_id) {
        const p = porId.get(l.periodo_id);
        buckets.set(chave, {
          chave,
          titulo: p
            ? `Aquisitivo ${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`
            : "Aquisitivo removido",
          periodoNumero: p?.numero ?? null,
          lancamentos: [],
        });
      } else {
        buckets.set(chave, {
          chave,
          titulo: "Sem período (abono avulso)",
          periodoNumero: null,
          lancamentos: [],
        });
      }
    }
    buckets.get(chave)!.lancamentos.push(l);
  }

  // Ordena aquisitivos: numero DESC (mais recente primeiro); "sem período" no fim
  const grupos = Array.from(buckets.values());
  grupos.sort((a, b) => {
    if (a.periodoNumero === null && b.periodoNumero === null) return 0;
    if (a.periodoNumero === null) return 1;
    if (b.periodoNumero === null) return -1;
    return b.periodoNumero - a.periodoNumero;
  });

  // Dentro de cada grupo: lançamento mais recente primeiro
  for (const g of grupos) {
    g.lancamentos.sort((a, b) =>
      b.data_inicio.localeCompare(a.data_inicio),
    );
  }

  return grupos;
}

function diasConsumidosNoGrupo(g: Grupo): number {
  return g.lancamentos
    .filter((l) => STATUS_CONSOME_SALDO.has(l.status))
    .reduce((acc, l) => acc + l.dias, 0);
}

/**
 * Histórico de lançamentos de férias — colapsado por padrão pra não
 * poluir a página. Clica no cabeçalho pra expandir. Lista em ordem
 * cronológica decrescente.
 */
export function HistoricoColapsavel({ lancamentos, periodos }: Props) {
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");

  const gruposFiltrados = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lancsFiltrados = !termo
      ? lancamentos
      : lancamentos.filter((l) => {
          const data = `${l.data_inicio} ${l.data_fim}`;
          const tipo = tipoLabel(l.tipo).toLowerCase();
          // Obs técnica de import não entra na busca — senão o RH digita
          // "import" e aparece tudo.
          const obs = isObsImport(l.observacao)
            ? ""
            : (l.observacao ?? "").toLowerCase();
          return (
            data.includes(termo) ||
            tipo.includes(termo) ||
            obs.includes(termo)
          );
        });
    return agrupar(lancsFiltrados, periodos);
  }, [lancamentos, periodos, busca]);

  const periodosPorId = React.useMemo(
    () => new Map(periodos.map((p) => [p.id, p])),
    [periodos],
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
          <History className="h-4 w-4 text-california-red" />
          Histórico de lançamentos
        </span>
        <span className="inline-flex items-center justify-center min-w-[24px] rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {lancamentos.length}
        </span>
      </button>

      {aberto && (
        <div className="mt-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por data, tipo ou observação..."
              className="w-full rounded-lg border border-border bg-white pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/15"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {gruposFiltrados.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              Nenhum lançamento encontrado.
            </div>
          ) : (
            <div className="space-y-3">
              {gruposFiltrados.map((g) => {
                const p = g.chave === "__sem_periodo__"
                  ? null
                  : periodosPorId.get(g.chave) ?? null;
                const usados = diasConsumidosNoGrupo(g);
                return (
                  <div
                    key={g.chave}
                    className="rounded-xl border border-border bg-white shadow-soft overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {g.titulo}
                        </p>
                        {p && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {usados} de {p.dias_direito} dias usados
                          </p>
                        )}
                      </div>
                      <span className="inline-flex items-center justify-center min-w-[24px] rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground border border-border">
                        {g.lancamentos.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-border">
                      {g.lancamentos.map((l) => (
                        <LinhaLancamento key={l.id} lanc={l} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                · {diasFolga} férias + {l.dias_abono} abono
              </>
            )}
            {l.lancado_direto_por_rh && <> · lançado pelo RH</>}
          </p>
          {/* Observações técnicas de import ("[Import xxx]") são
              rastreamento interno — não trazem valor pro usuário,
              escondidas. Observações manuais (notas do RH, motivos
              de reprovação) continuam aparecendo. */}
          {l.observacao && !isObsImport(l.observacao) && (
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

/**
 * Detecta observação técnica de import (histórico FériasAtt, 21.22.23,
 * FeriasPendencias, 15.18, ControleFerias). São rastros internos pro
 * dev — o usuário não precisa ver.
 */
function isObsImport(obs: string | null): boolean {
  if (!obs) return false;
  return obs.trimStart().startsWith("[Import");
}

function tipoLabel(t: FeriasLancamentoTipo): string {
  if (t === "usufruto") return "Férias";
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
    aguardando_gestor: {
      label: "Aguardando líder",
      cls: "bg-amber-100 text-amber-900",
    },
    pendente_aprovacao: {
      label: "Pendente",
      cls: "bg-amber-100 text-amber-900",
    },
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-800" },
    nf_anexada: {
      label: "NF Anexada",
      cls: "bg-sky-100 text-sky-800",
    },
    enviado_financeiro: {
      label: "Enviado Financeiro",
      cls: "bg-purple-100 text-purple-800",
    },
    aguardando_financeiro: {
      label: "Aguardando Financeiro",
      cls: "bg-purple-100 text-purple-800",
    },
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
