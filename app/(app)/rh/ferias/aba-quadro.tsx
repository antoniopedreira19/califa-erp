import { createClient } from "@/lib/supabase/server";
import type {
  Colaborador,
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  FeriasPeriodoStatus,
  TipoContratacao,
} from "@/lib/types";
import { QuadroListaCliente } from "./quadro-lista-cliente";

type Props = {
  tenantId: string;
  filtroInicial?: string;
};

/**
 * Linha do quadro — estilo aba "Acompanhamento" da planilha da California.
 * Mostra UMA linha por colaborador com o PERÍODO ATIVO (mais crítico) +
 * flags das 8 categorias de ação do dashboard pra filtrar sem nova query.
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
  // Flags das 8 categorias de ação. Cada uma vira um chip de filtro na
  // tela de Colaboradores E um card clicável no Dashboard. Sincronizadas
  // com o dashboard pra que a contagem bata.
  flags: {
    em_ferias_hoje: boolean;
    saindo_7d: boolean;
    voltando_7d: boolean;
    vencendo_30d: boolean;
    vencida_recente: boolean; // vencido com saldo, data_limite <= 1 ano atrás
    pendente_aprovacao: boolean;
    aguardando_nf: boolean; // status = aprovado (colaborador precisa anexar)
    aguardando_financeiro: boolean; // status = nf_anexada (RH precisa enviar)
  };
};

const PERIODO_SELECT =
  "id, colaborador_id, numero, aquisitivo_inicio, aquisitivo_fim, data_limite_gozo, dias_direito, status";

const DIAS_VENCIDA_RECENTE = 365;

export async function AbaQuadro({ tenantId, filtroInicial }: Props) {
  const supabase = createClient();

  const hojeISO = new Date().toISOString().slice(0, 10);
  const em7dISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const [colaboradoresRes, periodosRes, lancamentosRes, lancamentosFluxoRes] =
    await Promise.all([
      supabase
        .from("colaboradores")
        .select("id, nome, tipo_contratacao, funcao, data_admissao")
        .eq("tenant_id", tenantId)
        .eq("status", "ativo")
        .neq("tipo_contratacao", "socio")
        .order("nome", { ascending: true }),
      supabase
        .from("colaboradores_ferias_periodos")
        .select(PERIODO_SELECT)
        .eq("tenant_id", tenantId),
      // Pra consumo nos períodos (dias_usados)
      supabase
        .from("colaboradores_ferias_lancamentos")
        .select("colaborador_id, periodo_id, dias, status")
        .eq("tenant_id", tenantId)
        .in("status", ["aprovado", "concluido", "nf_anexada", "enviado_financeiro", "pendente_aprovacao"]),
      // Pra flags de "em férias hoje" / "saindo 7d" / "voltando 7d" /
      // pendente_aprovacao / aguardando_financeiro. Só considera lanç
      // que nasceu como solicitação (lancado_direto_por_rh=false) —
      // idêntico ao filtro usado no Dashboard e na tabela de Solicitações.
      supabase
        .from("colaboradores_ferias_lancamentos")
        .select("colaborador_id, status, data_inicio, data_fim")
        .eq("tenant_id", tenantId)
        .eq("lancado_direto_por_rh", false),
    ]);

  const colaboradores = (colaboradoresRes.data ?? []) as Pick<
    Colaborador,
    "id" | "nome" | "tipo_contratacao" | "funcao" | "data_admissao"
  >[];

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
  const lancamentosFluxo = (lancamentosFluxoRes.data ?? []) as Array<{
    colaborador_id: string;
    status: string;
    data_inicio: string;
    data_fim: string;
  }>;

  const periodosPorColab = new Map<string, PeriodoLite[]>();
  for (const p of periodos) {
    const arr = periodosPorColab.get(p.colaborador_id) ?? [];
    arr.push(p);
    periodosPorColab.set(p.colaborador_id, arr);
  }

  const diasUsadosPorPeriodo = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    diasUsadosPorPeriodo.set(
      l.periodo_id,
      (diasUsadosPorPeriodo.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  // Flags por colaborador vindas do fluxo de solicitações
  const flagsPorColab = new Map<
    string,
    {
      em_ferias_hoje: boolean;
      saindo_7d: boolean;
      voltando_7d: boolean;
      pendente_aprovacao: boolean;
      aguardando_nf: boolean;
      aguardando_financeiro: boolean;
    }
  >();
  for (const l of lancamentosFluxo) {
    const f = flagsPorColab.get(l.colaborador_id) ?? {
      em_ferias_hoje: false,
      saindo_7d: false,
      voltando_7d: false,
      pendente_aprovacao: false,
      aguardando_nf: false,
      aguardando_financeiro: false,
    };
    if (l.status === "pendente_aprovacao") f.pendente_aprovacao = true;
    // Pela trigger fn_sincroniza_status_lanc_por_nf, status='aprovado'
    // significa que ainda não tem NF anexada. Logo este estado é o
    // "colaborador precisa anexar NF".
    if (l.status === "aprovado") f.aguardando_nf = true;
    if (l.status === "nf_anexada") f.aguardando_financeiro = true;
    // Em férias agora = solicitação em qualquer status "ativo" com datas
    // contendo hoje (inclusive concluídas — colaborador continua fora até
    // voltar; ver docs/modulos/rh/41-ferias-fluxo-solicitacao.md §2.3)
    const ativoDeFerias =
      l.status === "aprovado" ||
      l.status === "nf_anexada" ||
      l.status === "enviado_financeiro" ||
      l.status === "concluido";
    if (ativoDeFerias) {
      if (l.data_inicio <= hojeISO && l.data_fim >= hojeISO) {
        f.em_ferias_hoje = true;
      }
      if (l.data_inicio > hojeISO && l.data_inicio <= em7dISO) {
        f.saindo_7d = true;
      }
      if (l.data_fim >= hojeISO && l.data_fim <= em7dISO) {
        f.voltando_7d = true;
      }
    }
    flagsPorColab.set(l.colaborador_id, f);
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limiteVencidoAntigoISO = (() => {
    const d = new Date(hoje);
    d.setDate(d.getDate() - DIAS_VENCIDA_RECENTE);
    return d.toISOString().slice(0, 10);
  })();

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
    // Excluir "vencidos antigos" (data_limite_gozo passou há mais de
    // DIAS_VENCIDA_RECENTE). São aquisitivos onde a pessoa pulou alguns
    // dias no passado mas voltou a tirar normalmente — ninguém vai
    // regularizar 2 dias de 2017 agora, é só ruído histórico. Esses
    // continuam aparecendo no histórico do colaborador em /rh/ferias/[id],
    // só somem da linha "aquisitivo ativo" do Quadro.
    const periodosDoColab = (periodosPorColab.get(c.id) ?? [])
      .filter((p) => {
        if (p.status !== "vencido") return true;
        return p.data_limite_gozo >= limiteVencidoAntigoISO;
      })
      .sort((a, b) => {
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

    // Flags de período: vencendo em 30d e vencida recente (<= 1 ano)
    const vencendo_30d =
      periodoAtivo != null &&
      periodoAtivo.dias_pendentes > 0 &&
      periodoAtivo.diasAteLimite >= 0 &&
      periodoAtivo.diasAteLimite <= 30;

    const vencida_recente =
      periodoAtivo != null &&
      periodoAtivo.status === "vencido" &&
      periodoAtivo.dias_pendentes > 0 &&
      periodoAtivo.diasAteLimite < 0 &&
      periodoAtivo.diasAteLimite >= -DIAS_VENCIDA_RECENTE;

    const flagsFluxo = flagsPorColab.get(c.id);

    return {
      id: c.id,
      nome: c.nome,
      tipo_contratacao: c.tipo_contratacao,
      funcao: c.funcao,
      data_admissao: c.data_admissao,
      periodoAtivo,
      flags: {
        em_ferias_hoje: flagsFluxo?.em_ferias_hoje ?? false,
        saindo_7d: flagsFluxo?.saindo_7d ?? false,
        voltando_7d: flagsFluxo?.voltando_7d ?? false,
        vencendo_30d,
        vencida_recente,
        pendente_aprovacao: flagsFluxo?.pendente_aprovacao ?? false,
        aguardando_nf: flagsFluxo?.aguardando_nf ?? false,
        aguardando_financeiro: flagsFluxo?.aguardando_financeiro ?? false,
      },
    };
  });

  return <QuadroListaCliente rows={rows} filtroInicial={filtroInicial} />;
}
