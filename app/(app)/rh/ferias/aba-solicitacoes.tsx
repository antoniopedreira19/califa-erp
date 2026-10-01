import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasLancamento,
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
} from "@/lib/types";
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
  { valor: "em_analise", label: "Em análise" },
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

  const { data } = await query;

  type Row = ColaboradorFeriasLancamento & {
    colaborador: {
      id: string;
      nome: string;
      tipo_contratacao: string;
    } | null;
  };
  const lancamentos = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTROS_STATUS.map((f) => {
          const ativo = f.valor === statusFiltro;
          return (
            <Link
              key={f.valor}
              href={`/rh/ferias?tab=solicitacoes&status=${f.valor}`}
              prefetch={false}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                ativo
                  ? "bg-california-red text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {f.label}
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
            {lancamentos.map((l) => (
              <li
                key={l.id}
                className="flex items-start gap-4 px-5 py-4 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold">
                      {l.colaborador?.nome ?? "—"}
                    </p>
                    <StatusBadge status={l.status} />
                    <TipoBadge tipo={l.tipo} />
                    {l.colaborador?.tipo_contratacao && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {l.colaborador.tipo_contratacao.toUpperCase()}
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
            ))}
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
    em_analise: { label: "Em análise", cls: "bg-sky-100 text-sky-800" },
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
