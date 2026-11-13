"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  Check,
  Loader2,
  AlertCircle,
  CalendarClock,
  Clock,
} from "lucide-react";
import { tipoContratacaoLabel } from "@/lib/types";
import type {
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
} from "@/lib/types";
import type { SolicitacaoRow } from "./aba-fluxo";
import { aprovarLancamento, reprovarLancamento } from "./actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Props = {
  rows: SolicitacaoRow[];
};

type FiltroStatus =
  | "todos"
  | "pendente_aprovacao"
  | "aprovado"
  | "reprovado"
  | "concluido"
  | "aguardando_financeiro"
  | "cancelado";

const FILTROS: Array<{
  key: FiltroStatus;
  label: string;
  cor: string;
}> = [
  { key: "todos", label: "Todos", cor: "bg-muted text-muted-foreground" },
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
    key: "aguardando_financeiro",
    label: "Ag. financeiro",
    cor: "bg-purple-100 text-purple-800",
  },
  {
    key: "concluido",
    label: "Concluídos",
    cor: "bg-slate-200 text-slate-700",
  },
  {
    key: "reprovado",
    label: "Reprovados",
    cor: "bg-red-100 text-red-800",
  },
];

export function SolicitacoesTabelaCliente({ rows }: Props) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState<FiltroStatus>("pendente_aprovacao");
  const [modalReprovar, setModalReprovar] =
    React.useState<SolicitacaoRow | null>(null);
  const [emAprovacao, setEmAprovacao] = React.useState<string | null>(null);

  // Contagens por status pros chips mostrarem badge
  const contagens = React.useMemo(() => {
    const m: Record<FiltroStatus, number> = {
      todos: rows.length,
      pendente_aprovacao: 0,
      aprovado: 0,
      reprovado: 0,
      concluido: 0,
      aguardando_financeiro: 0,
      cancelado: 0,
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

  async function handleAprovar(r: SolicitacaoRow) {
    setEmAprovacao(r.id);
    const res = await aprovarLancamento(r.id);
    setEmAprovacao(null);
    if (!res.ok) {
      alert("Falha ao aprovar: " + res.message);
      return;
    }
    router.refresh();
  }

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

      {/* Tabela */}
      {filtradas.length === 0 ? (
        <div className="rounded-xl border border-border bg-background py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma solicitação encontrada com esses filtros.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">
                  Colaborador
                </th>
                <th className="text-left px-3 py-2.5 font-medium">Período</th>
                <th className="text-left px-3 py-2.5 font-medium">Dias</th>
                <th className="text-left px-3 py-2.5 font-medium">Tipo</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtradas.map((r) => (
                <LinhaSolicitacao
                  key={r.id}
                  row={r}
                  emAprovacao={emAprovacao === r.id}
                  onAprovar={() => handleAprovar(r)}
                  onReprovar={() => setModalReprovar(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de reprovação */}
      {modalReprovar && (
        <ModalReprovar
          row={modalReprovar}
          onFechar={() => setModalReprovar(null)}
          onSucesso={() => {
            setModalReprovar(null);
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
  emAprovacao,
  onAprovar,
  onReprovar,
}: {
  row: SolicitacaoRow;
  emAprovacao: boolean;
  onAprovar: () => void;
  onReprovar: () => void;
}) {
  const pendente = r.status === "pendente_aprovacao";
  const regimeLabel = tipoContratacaoLabel(r.tipo_contratacao).split(" ")[0];
  const inicio = new Date(r.data_inicio + "T00:00:00").toLocaleDateString(
    "pt-BR",
  );
  const fim = new Date(r.data_fim + "T00:00:00").toLocaleDateString("pt-BR");
  const criadoEm = r.created_at
    ? new Date(r.created_at).toLocaleDateString("pt-BR")
    : null;

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3 align-top">
        <p className="font-medium truncate">{r.nome}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {r.funcao ?? "—"} ·{" "}
          <span className="uppercase tracking-wider">{regimeLabel}</span>
          {r.saldo_colaborador > 0 && (
            <>
              {" "}
              · saldo total {r.saldo_colaborador}d
            </>
          )}
        </p>
      </td>
      <td className="px-3 py-3 align-top">
        <p className="text-sm">
          {inicio} → {fim}
        </p>
        {criadoEm && pendente && (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            solicitado {criadoEm}
          </p>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        <span className="font-medium">{r.dias}</span>
        {r.dias_abono > 0 && (
          <span className="text-xs text-muted-foreground block">
            {r.dias - r.dias_abono} folga + {r.dias_abono} abono
          </span>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        <span className="text-xs">{tipoLabel(r.tipo)}</span>
      </td>
      <td className="px-3 py-3 align-top">
        <BadgeStatus status={r.status} />
        {r.motivo_reprovacao && (
          <p className="text-xs text-red-700 mt-1 max-w-[180px] truncate">
            {r.motivo_reprovacao}
          </p>
        )}
      </td>
      <td className="px-4 py-3 align-top text-right">
        {pendente ? (
          <div className="inline-flex gap-1.5">
            <button
              type="button"
              onClick={onReprovar}
              disabled={emAprovacao}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-california-red/10 hover:text-california-red hover:border-california-red/30 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Reprovar
            </button>
            <button
              type="button"
              onClick={onAprovar}
              disabled={emAprovacao}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {emAprovacao ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Aprovar
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">—</span>
        )}
      </td>
    </tr>
  );
}

/* ------------------------- Modal de reprovação ------------------------- */

function ModalReprovar({
  row,
  onFechar,
  onSucesso,
}: {
  row: SolicitacaoRow;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const res = await reprovarLancamento({
      lancamento_id: row.id,
      motivo,
    });
    setEnviando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onSucesso();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reprovar solicitação</DialogTitle>
          <DialogDescription>
            {row.nome} · {row.dias} dias ·{" "}
            {new Date(row.data_inicio + "T00:00:00").toLocaleDateString(
              "pt-BR",
            )}{" "}
            →{" "}
            {new Date(row.data_fim + "T00:00:00").toLocaleDateString("pt-BR")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-reprovar">Motivo</Label>
          <Textarea
            id="motivo-reprovar"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Explica pro colaborador o porquê da reprovação"
            rows={3}
          />
        </div>
        {erro && (
          <div className="flex items-start gap-2 text-sm text-california-red">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={confirmar}
            disabled={enviando || motivo.trim().length < 3}
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Reprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------- Helpers visuais ------------------------- */

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

function tipoLabel(t: FeriasLancamentoTipo): string {
  if (t === "usufruto") return "Férias";
  if (t === "abono_combinado") return "Férias + abono";
  if (t === "abono_avulso") return "Abono avulso";
  if (t === "abono_excepcional") return "Abono excepcional";
  return t;
}
