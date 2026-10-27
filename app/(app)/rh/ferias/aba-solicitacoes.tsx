import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasLancamento,
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";
import { formatarTipoContratacao } from "@/lib/colaboradores/format-tipo-contratacao";
import { AcoesLancamento } from "./acoes-lancamento";

type Props = {
  tenantId: string;
  statusFiltro: FeriasLancamentoStatus | "todos";
};

const FILTROS_STATUS: {
  valor: FeriasLancamentoStatus | "todos";
  label: string;
}[] = [
  { valor: "pendente_aprovacao", label: "Pendentes" },
  { valor: "aprovado", label: "Aprovadas" },
  { valor: "reprovado", label: "Reprovadas" },
  { valor: "cancelado", label: "Canceladas" },
  { valor: "todos", label: "Todas" },
];

export async function AbaSolicitacoes({ tenantId, statusFiltro }: Props) {
  const supabase = createClient();

  let query = supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, tipo, dias, data_inicio, data_fim, status, created_at, observacao, motivo_reprovacao, periodo_id, colaborador:colaboradores!colaborador_id(id, nome, tipo_contratacao)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (statusFiltro !== "todos") {
    query = query.eq("status", statusFiltro);
  }

  const [{ data }, { count: countPendentes }] = await Promise.all([
    query,
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pendente_aprovacao"),
  ]);

  type Row = ColaboradorFeriasLancamento & {
    colaborador: {
      id: string;
      nome: string;
      tipo_contratacao: string;
    } | null;
  };
  const lancamentos = (data ?? []) as unknown as Row[];

  const totalPendentes = countPendentes ?? 0;

  return (
    <div className="space-y-5">
      {/* Hero de pendências — destaca o backlog que o RH precisa resolver */}
      {totalPendentes > 0 && statusFiltro !== "pendente_aprovacao" && (
        <Link
          href="/rh/ferias?tab=solicitacoes&status=pendente_aprovacao"
          prefetch={false}
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              <strong>
                {totalPendentes}{" "}
                {totalPendentes === 1
                  ? "solicitação pendente"
                  : "solicitações pendentes"}
              </strong>{" "}
              aguardando sua aprovação
            </span>
          </div>
          <span className="text-xs font-medium underline">Ver pendentes</span>
        </Link>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTROS_STATUS.map((f) => {
          const ativo = f.valor === statusFiltro;
          const mostraContador =
            f.valor === "pendente_aprovacao" && totalPendentes > 0;
          return (
            <Link
              key={f.valor}
              href={`/rh/ferias?tab=solicitacoes&status=${f.valor}`}
              prefetch={false}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                ativo
                  ? "bg-california-red text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {f.label}
              {mostraContador && (
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] text-[10px] font-semibold ${
                    ativo
                      ? "bg-white/20 text-white"
                      : "bg-amber-200 text-amber-900"
                  }`}
                >
                  {totalPendentes}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Lista */}
      {lancamentos.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma solicitação neste status.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <ul className="divide-y divide-border">
            {lancamentos.map((l) => {
              const isPendente = l.status === "pendente_aprovacao";
              return (
              <li
                key={l.id}
                className={`flex items-start gap-4 px-5 py-4 flex-wrap transition-colors ${
                  isPendente
                    ? "border-l-4 border-l-amber-400 bg-amber-50/30"
                    : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">
                      {l.colaborador?.nome ?? "—"}
                    </p>
                    <StatusBadge status={l.status} />
                    <TipoBadge tipo={l.tipo} />
                    {l.colaborador?.tipo_contratacao && (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {formatarTipoContratacao(
                          l.colaborador.tipo_contratacao as TipoContratacao,
                        )}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {l.dias} {l.dias === 1 ? "dia" : "dias"} ·{" "}
                    {formatarData(l.data_inicio)} a{" "}
                    {formatarData(l.data_fim)}
                  </p>
                  {l.observacao && (
                    <p className="mt-1 text-xs text-muted-foreground italic">
                      Observação: {l.observacao}
                    </p>
                  )}
                  {l.motivo_reprovacao && (
                    <p className="mt-1 text-xs text-red-700">
                      Motivo da reprovação: {l.motivo_reprovacao}
                    </p>
                  )}
                </div>
                <AcoesLancamento
                  lancamentoId={l.id}
                  status={l.status}
                  colaboradorNome={l.colaborador?.nome ?? ""}
                />
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatarData(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
}

function StatusBadge({ status }: { status: FeriasLancamentoStatus }) {
  const map: Record<FeriasLancamentoStatus, { label: string; cls: string }> = {
    pendente_aprovacao: {
      label: "Pendente",
      cls: "bg-amber-100 text-amber-900",
    },
    aguardando_financeiro: { label: "Ag. financeiro", cls: "bg-purple-100 text-purple-800" },
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-800" },
    reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-800" },
    cancelado: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
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

function TipoBadge({ tipo }: { tipo: FeriasLancamentoTipo }) {
  const map: Record<FeriasLancamentoTipo, string> = {
    usufruto: "Férias",
    abono_combinado: "Abono combinado",
    abono_avulso: "Abono avulso",
    abono_excepcional: "Abono excepcional",
  };
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
      {map[tipo]}
    </span>
  );
}
