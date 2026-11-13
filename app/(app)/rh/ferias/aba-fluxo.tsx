import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasLancamento,
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";
import { SolicitacoesTabelaCliente } from "./solicitacoes-tabela-cliente";

export type SolicitacaoRow = {
  id: string;
  colaborador_id: string;
  nome: string;
  tipo_contratacao: TipoContratacao;
  funcao: string | null;
  tipo: FeriasLancamentoTipo;
  dias: number;
  dias_abono: number;
  data_inicio: string;
  data_fim: string;
  status: FeriasLancamentoStatus;
  lancado_direto_por_rh: boolean;
  created_at: string;
  aprovado_em: string | null;
  motivo_reprovacao: string | null;
  observacao: string | null;
  saldo_colaborador: number;
};

/**
 * Aba Solicitações — substituiu o kanban do antigo Fluxo em 2026-11-13.
 * O kanban tinha 5 colunas das quais 4 ficavam vazias na maior parte do
 * tempo; a Finalizadas virou depósito histórico de ~400 linhas rolando.
 *
 * Nova forma: tabela densa com chip de status pra filtrar + busca por
 * nome + aprovar/reprovar inline nos pendentes. Clicar na linha abre
 * detalhe do colaborador (saldo, alocação, histórico).
 */
export async function AbaFluxo({ tenantId }: { tenantId: string }) {
  const supabase = createClient();

  // Puxa TODAS as solicitações do tenant (até ~500 esperadas por ano).
  // Em memória: ordenação + filtro vão ser client-side pra ficar
  // instantâneos ao RH mudar chip de status.
  const { data: lancs } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, colaborador_id, tipo, dias, dias_abono, data_inicio, data_fim, status, lancado_direto_por_rh, created_at, aprovado_em, motivo_reprovacao, observacao",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  const lancamentos = (lancs ?? []) as Array<
    Pick<
      ColaboradorFeriasLancamento,
      | "id"
      | "colaborador_id"
      | "tipo"
      | "dias"
      | "dias_abono"
      | "data_inicio"
      | "data_fim"
      | "status"
      | "lancado_direto_por_rh"
      | "created_at"
      | "aprovado_em"
      | "motivo_reprovacao"
      | "observacao"
    >
  >;

  const colabIds = Array.from(
    new Set(lancamentos.map((l) => l.colaborador_id)),
  );

  const [colabsRes, periodosRes] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id, nome, tipo_contratacao, funcao, status")
      .in("id", colabIds.length > 0 ? colabIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase
      .from("colaboradores_ferias_periodos")
      .select("id, colaborador_id, dias_direito")
      .eq("tenant_id", tenantId)
      .in(
        "colaborador_id",
        colabIds.length > 0
          ? colabIds
          : ["00000000-0000-0000-0000-000000000000"],
      ),
  ]);

  const colabsPorId = new Map(
    (colabsRes.data ?? []).map((c) => [c.id, c] as const),
  );

  // Calcula saldo total por colaborador: soma direito dos períodos menos
  // consumo de todos os lançamentos aprovados/concluídos/pendentes.
  const direitoPorColab = new Map<string, number>();
  for (const p of periodosRes.data ?? []) {
    const atual = direitoPorColab.get(p.colaborador_id) ?? 0;
    direitoPorColab.set(p.colaborador_id, atual + (p.dias_direito ?? 0));
  }
  const consumidoPorColab = new Map<string, number>();
  for (const l of lancamentos) {
    if (
      l.status !== "aprovado" &&
      l.status !== "concluido" &&
      l.status !== "pendente_aprovacao"
    )
      continue;
    const atual = consumidoPorColab.get(l.colaborador_id) ?? 0;
    consumidoPorColab.set(l.colaborador_id, atual + (l.dias ?? 0));
  }

  const rows: SolicitacaoRow[] = lancamentos.map((l) => {
    const c = colabsPorId.get(l.colaborador_id);
    const saldo = Math.max(
      (direitoPorColab.get(l.colaborador_id) ?? 0) -
        (consumidoPorColab.get(l.colaborador_id) ?? 0),
      0,
    );
    return {
      id: l.id,
      colaborador_id: l.colaborador_id,
      nome: c?.nome ?? "—",
      tipo_contratacao: (c?.tipo_contratacao ?? "pj") as TipoContratacao,
      funcao: c?.funcao ?? null,
      tipo: l.tipo,
      dias: l.dias,
      dias_abono: l.dias_abono ?? 0,
      data_inicio: l.data_inicio,
      data_fim: l.data_fim,
      status: l.status,
      lancado_direto_por_rh: l.lancado_direto_por_rh ?? false,
      created_at: l.created_at,
      aprovado_em: l.aprovado_em,
      motivo_reprovacao: l.motivo_reprovacao,
      observacao: l.observacao,
      saldo_colaborador: saldo,
    };
  });

  return <SolicitacoesTabelaCliente rows={rows} />;
}
