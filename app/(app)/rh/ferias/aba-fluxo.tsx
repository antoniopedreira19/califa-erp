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
  alocacao_empresa: string | null;
  alocacao_regional: string | null;
};

/**
 * Aba Solicitações — substituiu o kanban do antigo Fluxo em 2026-11-13.
 *
 * Filtro intencional: só mostra lançamentos que nasceram como solicitação
 * do colaborador (lancado_direto_por_rh = false). Imports históricos e
 * registros diretos pelo RH ficam fora — eles não têm fluxo de aprovação
 * nem NF pra acompanhar, viram ruído na lista.
 */
export async function AbaFluxo({ tenantId }: { tenantId: string }) {
  const supabase = createClient();

  // Puxa só solicitações reais (não-import). Esperado ficar baixo,
  // ordenação + filtro continuam client-side.
  const { data: lancs } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, colaborador_id, tipo, dias, dias_abono, data_inicio, data_fim, status, lancado_direto_por_rh, created_at, aprovado_em, motivo_reprovacao, observacao",
    )
    .eq("tenant_id", tenantId)
    .eq("lancado_direto_por_rh", false)
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

  const colabIdsSeguro =
    colabIds.length > 0 ? colabIds : ["00000000-0000-0000-0000-000000000000"];

  const [colabsRes, alocacoesRes] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id, nome, tipo_contratacao, funcao, status")
      .in("id", colabIdsSeguro),
    supabase
      .from("colaboradores_alocacoes")
      .select(
        "colaborador_id, data_inicio, empresa:empresas(nome), regional:regionais(nome)",
      )
      .eq("tenant_id", tenantId)
      .in("colaborador_id", colabIdsSeguro)
      .is("data_fim", null),
  ]);

  const colabsPorId = new Map(
    (colabsRes.data ?? []).map((c) => [c.id, c] as const),
  );

  // Pega a alocação ativa mais recente por colaborador. Pode ter mais
  // de uma (rateio), aqui só a primeira — é só pra identificar na linha.
  type AlocRow = {
    colaborador_id: string;
    data_inicio: string | null;
    empresa: { nome: string | null } | { nome: string | null }[] | null;
    regional: { nome: string | null } | { nome: string | null }[] | null;
  };
  const alocacoesPorColab = new Map<
    string,
    { empresa: string | null; regional: string | null }
  >();
  const alocacoesOrdenadas = ((alocacoesRes.data ?? []) as AlocRow[]).sort(
    (a, b) => (b.data_inicio ?? "").localeCompare(a.data_inicio ?? ""),
  );
  for (const a of alocacoesOrdenadas) {
    if (alocacoesPorColab.has(a.colaborador_id)) continue;
    const emp = Array.isArray(a.empresa) ? a.empresa[0] : a.empresa;
    const reg = Array.isArray(a.regional) ? a.regional[0] : a.regional;
    alocacoesPorColab.set(a.colaborador_id, {
      empresa: emp?.nome ?? null,
      regional: reg?.nome ?? null,
    });
  }

  const rows: SolicitacaoRow[] = lancamentos.map((l) => {
    const c = colabsPorId.get(l.colaborador_id);
    const alocacao = alocacoesPorColab.get(l.colaborador_id);
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
      alocacao_empresa: alocacao?.empresa ?? null,
      alocacao_regional: alocacao?.regional ?? null,
    };
  });

  return <SolicitacoesTabelaCliente rows={rows} />;
}
