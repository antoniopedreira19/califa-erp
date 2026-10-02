import { createClient } from "@/lib/supabase/server";
import type {
  Colaborador,
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  FeriasPeriodoStatus,
  TipoContratacao,
} from "@/lib/types";
import { QuadroFiltros } from "./quadro-filtros";
import { QuadroListaCliente } from "./quadro-lista-cliente";

type Props = {
  tenantId: string;
  busca: string;
  tipoContratacao: string;
  statusPeriodo: string;
};

/**
 * Linha do quadro — estilo aba "Acompanhamento" da planilha da California.
 * Mostra UMA linha por colaborador com o PERÍODO ATIVO (mais crítico).
 */
export type QuadroColaboradorRow = {
  id: string;
  nome: string;
  tipo_contratacao: TipoContratacao;
  funcao: string;
  data_admissao: string;
  periodoAtivo: {
    rotulo: string;
    status: FeriasPeriodoStatus;
    dias_direito: number;
    dias_usados: number;
    dias_pendentes: number;
    data_limite_gozo: string;
    diasAteLimite: number;
  } | null;
};

// Payload mínimo — só os campos usados no cálculo das rows do Quadro.
const PERIODO_SELECT =
  "id, colaborador_id, numero, aquisitivo_inicio, aquisitivo_fim, data_limite_gozo, dias_direito, status";

export async function AbaQuadro({
  tenantId,
  busca,
  tipoContratacao,
  statusPeriodo,
}: Props) {
  const supabase = createClient();

  let colabQuery = supabase
    .from("colaboradores")
    .select("id, nome, tipo_contratacao, funcao, data_admissao")
    .eq("tenant_id", tenantId)
    .eq("status", "ativo")
    .order("nome", { ascending: true });

  if (busca.trim()) {
    colabQuery = colabQuery.ilike("nome", `%${busca.trim()}%`);
  }
  if (tipoContratacao) {
    colabQuery = colabQuery.eq("tipo_contratacao", tipoContratacao);
  }

  // 3 queries em paralelo — SEM query do modal (modal fica client-side).
  const [colaboradoresRes, periodosRes, lancamentosRes] = await Promise.all([
    colabQuery,
    supabase
      .from("colaboradores_ferias_periodos")
      .select(PERIODO_SELECT)
      .eq("tenant_id", tenantId),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("colaborador_id, periodo_id, dias, status")
      .eq("tenant_id", tenantId)
      .in("status", [
        "aprovado",
        "concluido",
        "pendente_aprovacao",
        "em_analise",
      ]),
  ]);

  const colaboradores = (colaboradoresRes.data ?? []) as Pick<
    Colaborador,
    "id" | "nome" | "tipo_contratacao" | "funcao" | "data_admissao"
  >[];

  if (colaboradores.length === 0) {
    return (
      <>
        <QuadroFiltros
          busca={busca}
          tipoContratacao={tipoContratacao}
          statusPeriodo={statusPeriodo}
          totalColaboradores={0}
        />
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum colaborador encontrado com esses filtros.
          </p>
        </div>
      </>
    );
  }

  type PeriodoLite = Pick<
    ColaboradorFeriasPeriodo,
    | "id"
    | "colaborador_id"
    | "numero"
    | "aquisitivo_inicio"
    | "aquisitivo_fim"
    | "data_limite_gozo"
    | "dias_direito"
    | "status"
  >;
  const periodos = (periodosRes.data ?? []) as PeriodoLite[];
  const lancamentos = (lancamentosRes.data ?? []) as Array<
    Pick<
      ColaboradorFeriasLancamento,
      "colaborador_id" | "periodo_id" | "dias" | "status"
    >
  >;

  const periodosPorColab = new Map<string, PeriodoLite[]>();
  for (const p of periodos) {
    const arr = periodosPorColab.get(p.colaborador_id) ?? [];
    arr.push(p);
    periodosPorColab.set(p.colaborador_id, arr);
  }

  const diasUsadosPorPeriodo = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    if (l.status !== "aprovado" && l.status !== "concluido") continue;
    diasUsadosPorPeriodo.set(
      l.periodo_id,
      (diasUsadosPorPeriodo.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const prioridade: Record<FeriasPeriodoStatus, number> = {
    vencido: 1,
    em_alerta: 2,
    apto: 3,
    incompleto: 4,
    nao_habilitado: 5,
    regularizado: 6,
    pago_rescisao: 7,
  };

  const rows: QuadroColaboradorRow[] = colaboradores.map((c) => {
    const periodosDoColab = (periodosPorColab.get(c.id) ?? []).sort((a, b) => {
      const dp = prioridade[a.status] - prioridade[b.status];
      if (dp !== 0) return dp;
      return a.data_limite_gozo.localeCompare(b.data_limite_gozo);
    });

    const ativo = periodosDoColab[0] ?? null;

    const periodoAtivo = ativo
      ? (() => {
          const usados = diasUsadosPorPeriodo.get(ativo.id) ?? 0;
          const pendentes = Math.max(ativo.dias_direito - usados, 0);
          const limiteDate = new Date(ativo.data_limite_gozo + "T00:00:00");
          const diasAteLimite = Math.ceil(
            (limiteDate.getTime() - hoje.getTime()) / 86_400_000,
          );
          return {
            rotulo: `${ativo.aquisitivo_inicio.slice(0, 4)}/${ativo.aquisitivo_fim.slice(0, 4)}`,
            status: ativo.status,
            dias_direito: ativo.dias_direito,
            dias_usados: usados,
            dias_pendentes: pendentes,
            data_limite_gozo: ativo.data_limite_gozo,
            diasAteLimite,
          };
        })()
      : null;

    return {
      id: c.id,
      nome: c.nome,
      tipo_contratacao: c.tipo_contratacao,
      funcao: c.funcao,
      data_admissao: c.data_admissao,
      periodoAtivo,
    };
  });

  const rowsFiltradas = statusPeriodo
    ? rows.filter((r) => r.periodoAtivo?.status === statusPeriodo)
    : rows;

  return (
    <>
      <QuadroFiltros
        busca={busca}
        tipoContratacao={tipoContratacao}
        statusPeriodo={statusPeriodo}
        totalColaboradores={rowsFiltradas.length}
      />

      {rowsFiltradas.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum colaborador neste filtro.
          </p>
        </div>
      ) : (
        <QuadroListaCliente rows={rowsFiltradas} />
      )}
    </>
  );
}
