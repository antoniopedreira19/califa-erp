"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  CalendarClock,
  ClipboardList,
} from "lucide-react";
import { tipoContratacaoLabel } from "@/lib/types";
import type {
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
} from "@/lib/types";
import type { SolicitacaoRow } from "./aba-fluxo";
import { ModalDetalheSolicitacao } from "./modal-detalhe-solicitacao";

type Props = {
  rows: SolicitacaoRow[];
};

type FiltroStatus =
  | "todos"
  | "pendente_aprovacao"
  | "aprovado"
  | "nf_anexada"
  | "enviado_financeiro"
  | "concluido";

const FILTROS: Array<{
  key: FiltroStatus;
  label: string;
  cor: string;
}> = [
  { key: "todos", label: "Todas", cor: "bg-muted text-muted-foreground" },
  {
    key: "pendente_aprovacao",
    label: "Pendentes",
    cor: "bg-amber-100 text-amber-900",
  },
  {
    key: "aprovado",
    label: "Aprovados",
    cor: "bg-emerald-100 text-emerald-800",
  },
  {
    key: "nf_anexada",
    label: "NF Anexada",
    cor: "bg-sky-100 text-sky-800",
  },
  {
    key: "enviado_financeiro",
    label: "Enviado Financeiro",
    cor: "bg-purple-100 text-purple-800",
  },
  {
    key: "concluido",
    label: "Concluídos",
    cor: "bg-slate-200 text-slate-700",
  },
];

export function SolicitacoesTabelaCliente({ rows }: Props) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState<FiltroStatus>("todos");
  const [selecionada, setSelecionada] =
    React.useState<SolicitacaoRow | null>(null);

  // Contagens por status pros chips mostrarem badge
  const contagens = React.useMemo(() => {
    const m: Record<FiltroStatus, number> = {
      todos: rows.length,
      pendente_aprovacao: 0,
      aprovado: 0,
      nf_anexada: 0,
      enviado_financeiro: 0,
      concluido: 0,
    };
    for (const r of rows) {
      if (r.status in m) (m as Record<string, number>)[r.status] += 1;
    }
    return m;
  }, [rows]);

  const filtradas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro !== "todos" && r.status !== filtro) return false;
      if (termo && !r.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [rows, busca, filtro]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CalendarClock className="h-12 w-12 text-muted-foreground mb-3" />
        <p className="text-base font-medium">Sem solicitações registradas</p>
        <p className="text-sm text-muted-foreground mt-1">
          Quando alguém solicitar férias, aparecerá aqui pra aprovação.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Busca + chips de filtro */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar colaborador..."
            className="w-full rounded-full border border-border bg-background pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/30"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTROS.map((f) => {
            const ativo = filtro === f.key;
            const count = contagens[f.key] ?? 0;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFiltro(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  ativo
                    ? "border-california-red bg-california-red text-white"
                    : `border-border ${f.cor} hover:brightness-95`
                }`}
              >
                {f.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] rounded-full px-1 text-[10px] font-semibold ${
                    ativo ? "bg-white/20 text-white" : "bg-white/60"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabela — estilo igual ao /freelancers/solicitacoes */}
      {filtradas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Nenhuma solicitação encontrada
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajuste os filtros ou mude a busca.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/20 border-b border-border">
                <tr>
                  <Th>Colaborador</Th>
                  <Th>Alocação</Th>
                  <Th>Período</Th>
                  <Th align="center">Dias</Th>
                  <Th>Tipo</Th>
                  <Th>Solicitado em</Th>
                  <Th align="center">Status</Th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((r) => (
                  <LinhaSolicitacao
                    key={r.id}
                    row={r}
                    onAbrir={() => setSelecionada(r)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de detalhe */}
      {selecionada && (
        <ModalDetalheSolicitacao
          row={selecionada}
          onFechar={() => setSelecionada(null)}
          onSucesso={() => {
            setSelecionada(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------- Linha da tabela ------------------------- */

function LinhaSolicitacao({
  row: r,
  onAbrir,
}: {
  row: SolicitacaoRow;
  onAbrir: () => void;
}) {
  const regimeLabel = tipoContratacaoLabel(r.tipo_contratacao).split(" ")[0];
  const inicio = new Date(r.data_inicio + "T00:00:00").toLocaleDateString(
    "pt-BR",
  );
  const fim = new Date(r.data_fim + "T00:00:00").toLocaleDateString("pt-BR");
  const criadoEm = r.created_at
    ? new Date(r.created_at).toLocaleDateString("pt-BR")
    : "—";

  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer"
    >
      <Td>
        <p className="font-semibold text-foreground text-sm">{r.nome}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wider">
          {regimeLabel}
          {r.funcao && <> · {r.funcao}</>}
        </p>
      </Td>
      <Td>
        {r.alocacao_empresa ? (
          <>
            <p className="text-xs text-foreground">{r.alocacao_empresa}</p>
            {r.alocacao_regional && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {r.alocacao_regional}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </Td>
      <Td>
        <p className="text-sm text-foreground">
          {inicio} <span className="text-muted-foreground">→</span> {fim}
        </p>
      </Td>
      <Td align="center">
        <p className="text-sm font-semibold text-foreground">{r.dias}</p>
        {r.dias_abono > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {r.dias - r.dias_abono}f + {r.dias_abono}a
          </p>
        )}
      </Td>
      <Td>
        <p className="text-xs text-foreground">{tipoLabel(r.tipo)}</p>
      </Td>
      <Td>
        <p className="text-xs text-muted-foreground">{criadoEm}</p>
      </Td>
      <Td align="center">
        <BadgeStatus status={r.status} />
      </Td>
    </tr>
  );
}

/* ------------------------- Helpers de tabela ---------------------- */

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const alignCls =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  return (
    <th
      className={`px-4 py-2.5 ${alignCls} text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const alignCls =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  return <td className={`px-4 py-3 align-top ${alignCls}`}>{children}</td>;
}

/* ------------------------- Helpers visuais ------------------------- */

function BadgeStatus({ status }: { status: FeriasLancamentoStatus }) {
  const map: Record<
    FeriasLancamentoStatus,
    { label: string; cls: string; dot: string }
  > = {
    pendente_aprovacao: {
      label: "Pendente",
      cls: "bg-amber-100 text-amber-900",
      dot: "bg-amber-500",
    },
    aprovado: {
      label: "Aprovado",
      cls: "bg-emerald-100 text-emerald-800",
      dot: "bg-emerald-500",
    },
    nf_anexada: {
      label: "NF Anexada",
      cls: "bg-sky-100 text-sky-800",
      dot: "bg-sky-500",
    },
    enviado_financeiro: {
      label: "Enviado Financeiro",
      cls: "bg-purple-100 text-purple-800",
      dot: "bg-purple-500",
    },
    aguardando_financeiro: {
      label: "Aguardando Financeiro",
      cls: "bg-purple-100 text-purple-800",
      dot: "bg-purple-500",
    },
    reprovado: {
      label: "Reprovado",
      cls: "bg-red-100 text-red-800",
      dot: "bg-red-500",
    },
    cancelado: {
      label: "Cancelado",
      cls: "bg-muted text-muted-foreground",
      dot: "bg-muted-foreground",
    },
    concluido: {
      label: "Concluído",
      cls: "bg-slate-200 text-slate-700",
      dot: "bg-slate-500",
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}

function tipoLabel(t: FeriasLancamentoTipo): string {
  if (t === "usufruto") return "Férias";
  if (t === "abono_combinado") return "Férias + abono";
  if (t === "abono_avulso") return "Abono avulso";
  if (t === "abono_excepcional") return "Abono excepcional";
  return t;
}
