import { createClient } from "@/lib/supabase/server";
import type {
  Colaborador,
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  FeriasPeriodoStatus,
  TipoContratacao,
} from "@/lib/types";
import { QuadroFiltros } from "./quadro-filtros";
import { LinhaQuadro } from "./linha-quadro";
import { DrawerDetalheColaborador } from "./drawer-detalhe-colaborador";

type Props = {
  tenantId: string;
  busca: string;
  tipoContratacao: string;
  statusPeriodo: string;
  colaboradorSelecionadoId?: string;
};

export type QuadroColaboradorRow = {
  id: string;
  nome: string;
  tipo_contratacao: TipoContratacao;
  funcao: string;
  saldoTotal: number;
  statusPrincipal: FeriasPeriodoStatus | "sem_direito";
  proximoVencimento: string | null;
  diasProximoVencimento: number | null;
};

export async function AbaQuadro({
  tenantId,
  busca,
  tipoContratacao,
  statusPeriodo,
  colaboradorSelecionadoId,
}: Props) {
  const supabase = createClient();

  // Puxa colaboradores ativos (base)
  let colabQuery = supabase
    .from("colaboradores")
    .select("id, nome, tipo_contratacao, funcao")
    .eq("tenant_id", tenantId)
    .eq("status", "ativo")
    .order("nome", { ascending: true });

  if (busca.trim()) {
    colabQuery = colabQuery.ilike("nome", `%${busca.trim()}%`);
  }
  if (tipoContratacao) {
    colabQuery = colabQuery.eq("tipo_contratacao", tipoContratacao);
  }

  const { data: colaboradoresData } = await colabQuery;
  const colaboradores = (colaboradoresData ?? []) as Pick<
    Colaborador,
    "id" | "nome" | "tipo_contratacao" | "funcao"
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

  const colabIds = colaboradores.map((c) => c.id);

  // Puxa períodos e lançamentos aprovados+concluídos em paralelo
  const [periodosRes, lancamentosRes] = await Promise.all([
    supabase
      .from("colaboradores_ferias_periodos")
      .select("*")
      .in("colaborador_id", colabIds),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("colaborador_id, periodo_id, dias, status, data_inicio")
      .in("colaborador_id", colabIds)
      .in("status", ["aprovado", "concluido", "pendente_aprovacao", "em_analise"]),
  ]);

  const periodos = (periodosRes.data ?? []) as ColaboradorFeriasPeriodo[];
  const lancamentos = (lancamentosRes.data ?? []) as Array<
    Pick<
      ColaboradorFeriasLancamento,
      "colaborador_id" | "periodo_id" | "dias" | "status" | "data_inicio"
    >
  >;

  // Agrupa dados por colaborador
  const periodosPorColab = new Map<string, ColaboradorFeriasPeriodo[]>();
  for (const p of periodos) {
    const arr = periodosPorColab.get(p.colaborador_id) ?? [];
    arr.push(p);
    periodosPorColab.set(p.colaborador_id, arr);
  }

  // Dias ocupados (aprovado + concluído + pendente + em_analise) por período
  const diasOcupadosPorPeriodo = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    diasOcupadosPorPeriodo.set(
      l.periodo_id,
      (diasOcupadosPorPeriodo.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  // Monta rows com cálculos
  const rows: QuadroColaboradorRow[] = colaboradores.map((c) => {
    const periodosDoColab = (periodosPorColab.get(c.id) ?? []).sort(
      (a, b) => a.numero - b.numero,
    );

    // Saldo = soma dos dias pendentes de aptos + em_alerta
    const saldoTotal = periodosDoColab
      .filter((p) => p.status === "apto" || p.status === "em_alerta")
      .reduce((acc, p) => {
        const ocupados = diasOcupadosPorPeriodo.get(p.id) ?? 0;
        return acc + Math.max(p.dias_direito - ocupados, 0);
      }, 0);

    // Status principal: pior entre vencido > em_alerta > apto > incompleto > ...
    const temVencido = periodosDoColab.some((p) => p.status === "vencido");
    const temAlerta = periodosDoColab.some((p) => p.status === "em_alerta");
    const temApto = periodosDoColab.some((p) => p.status === "apto");
    const statusPrincipal: QuadroColaboradorRow["statusPrincipal"] = temVencido
      ? "vencido"
      : temAlerta
        ? "em_alerta"
        : temApto
          ? "apto"
          : periodosDoColab.length > 0
            ? "incompleto"
            : "sem_direito";

    // Próximo vencimento
    const proximos = periodosDoColab
      .filter((p) => p.status === "apto" || p.status === "em_alerta")
      .map((p) => new Date(p.concessivo_fim + "T00:00:00"))
      .sort((a, b) => a.getTime() - b.getTime());
    const proximoDate = proximos[0];
    const proximoVencimento = proximoDate
      ? proximoDate.toISOString().slice(0, 10)
      : null;
    const diasProximoVencimento = proximoDate
      ? Math.ceil(
          (proximoDate.getTime() - hoje.getTime()) / 86_400_000,
        )
      : null;

    return {
      id: c.id,
      nome: c.nome,
      tipo_contratacao: c.tipo_contratacao,
      funcao: c.funcao,
      saldoTotal,
      statusPrincipal,
      proximoVencimento,
      diasProximoVencimento,
    };
  });

  // Filtro por status (feito depois do cálculo pq é derivado)
  const rowsFiltradas = statusPeriodo
    ? rows.filter((r) => r.statusPrincipal === statusPeriodo)
    : rows;

  // Dados do colaborador selecionado pro drawer (se houver)
  const colabSelecionado = colaboradoresData?.find(
    (c) => c.id === colaboradorSelecionadoId,
  );
  const periodosSelecionado = colabSelecionado
    ? (periodosPorColab.get(colabSelecionado.id) ?? []).sort(
        (a, b) => a.numero - b.numero,
      )
    : [];

  // Pra drawer, puxa também TODOS os lançamentos (não só aprovados)
  let lancamentosDoColab: ColaboradorFeriasLancamento[] = [];
  if (colabSelecionado) {
    const { data } = await supabase
      .from("colaboradores_ferias_lancamentos")
      .select("*")
      .eq("colaborador_id", colabSelecionado.id)
      .order("data_inicio", { ascending: false });
    lancamentosDoColab = (data ?? []) as ColaboradorFeriasLancamento[];
  }

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
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <div className="hidden md:grid grid-cols-[1.5fr_0.6fr_1fr_0.8fr_1.1fr] gap-4 bg-muted/40 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span>Colaborador</span>
            <span>Tipo</span>
            <span>Status principal</span>
            <span>Saldo</span>
            <span>Próximo vencimento</span>
          </div>
          <ul className="divide-y divide-border">
            {rowsFiltradas.map((row) => (
              <LinhaQuadro key={row.id} row={row} />
            ))}
          </ul>
        </div>
      )}

      {colabSelecionado && (
        <DrawerDetalheColaborador
          colaborador={{
            id: colabSelecionado.id,
            nome: colabSelecionado.nome,
            tipo_contratacao: colabSelecionado.tipo_contratacao,
            funcao: colabSelecionado.funcao,
          }}
          periodos={periodosSelecionado}
          lancamentos={lancamentosDoColab}
        />
      )}
    </>
  );
}
