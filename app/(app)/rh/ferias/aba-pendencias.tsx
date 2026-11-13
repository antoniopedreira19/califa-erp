import { createClient } from "@/lib/supabase/server";
import { avaliarPendenciasFerias } from "@/lib/rh/pendencias-ferias";
import type {
  LancamentoParaPendencias,
  NivelPendenciaFerias,
  PendenciaFerias,
  PeriodoParaPendencias,
} from "@/lib/rh/pendencias-ferias";
import { PendenciasListaCliente } from "./pendencias-lista-cliente";

type Props = {
  tenantId: string;
};

/**
 * Linha agregada por colaborador — envia pra UI só o que precisa pra
 * renderizar a lista e o drawer. Nada de valores financeiros ou de
 * informações pessoais além do nome e tipo de contratação.
 */
export type PendenciaColaboradorRow = {
  colaborador_id: string;
  nome: string;
  tipo_contratacao: string;
  nivel: NivelPendenciaFerias;
  resumo: { criticas: number; alertas: number; infos: number };
  total: number;
  itens: PendenciaFerias[];
  periodos: Array<{
    id: string;
    aquisitivo: string;
    dias_direito: number;
    status: string;
  }>;
  lancamentos: Array<{
    id: string;
    periodo_id: string | null;
    tipo: string;
    dias: number;
    dias_abono: number;
    data_inicio: string | null;
    data_fim: string | null;
    status: string;
    observacao: string | null;
  }>;
};

export async function AbaPendencias({ tenantId }: Props) {
  const supabase = createClient();

  const [colabRes, periodosRes, lancRes] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id, nome, tipo_contratacao")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .neq("tipo_contratacao", "socio")
      .order("nome", { ascending: true }),
    supabase
      .from("colaboradores_ferias_periodos")
      .select(
        "id, colaborador_id, aquisitivo_inicio, aquisitivo_fim, concessivo_fim, dias_direito, status",
      )
      .eq("tenant_id", tenantId),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, colaborador_id, periodo_id, tipo, dias, dias_abono, data_inicio, data_fim, status, observacao",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aprovado", "concluido"]),
  ]);

  const colaboradores = colabRes.data ?? [];
  const periodos = periodosRes.data ?? [];
  const lancamentos = lancRes.data ?? [];

  const periodosPorColab = new Map<string, typeof periodos>();
  for (const p of periodos) {
    const arr = periodosPorColab.get(p.colaborador_id) ?? [];
    arr.push(p);
    periodosPorColab.set(p.colaborador_id, arr);
  }

  const lancsPorColab = new Map<string, typeof lancamentos>();
  for (const l of lancamentos) {
    const arr = lancsPorColab.get(l.colaborador_id) ?? [];
    arr.push(l);
    lancsPorColab.set(l.colaborador_id, arr);
  }

  const rows: PendenciaColaboradorRow[] = [];
  for (const c of colaboradores) {
    const periodosColab = periodosPorColab.get(c.id) ?? [];
    const lancsColab = lancsPorColab.get(c.id) ?? [];

    const periodosParaCalc: PeriodoParaPendencias[] = periodosColab.map(
      (p) => ({
        id: p.id,
        aquisitivo_inicio: p.aquisitivo_inicio,
        aquisitivo_fim: p.aquisitivo_fim,
        concessivo_fim: p.concessivo_fim,
        dias_direito: p.dias_direito,
      }),
    );
    const lancsParaCalc: LancamentoParaPendencias[] = lancsColab.map((l) => ({
      id: l.id,
      periodo_id: l.periodo_id,
      tipo: l.tipo as LancamentoParaPendencias["tipo"],
      dias: l.dias,
      dias_abono: l.dias_abono ?? 0,
      data_inicio: l.data_inicio,
      data_fim: l.data_fim,
    }));

    const avaliacao = avaliarPendenciasFerias({
      periodos: periodosParaCalc,
      lancamentos: lancsParaCalc,
    });

    if (avaliacao.nivel === "ok") continue;

    rows.push({
      colaborador_id: c.id,
      nome: c.nome,
      tipo_contratacao: c.tipo_contratacao,
      nivel: avaliacao.nivel,
      resumo: avaliacao.resumo,
      total: avaliacao.total,
      itens: avaliacao.itens,
      periodos: periodosColab.map((p) => ({
        id: p.id,
        aquisitivo:
          p.aquisitivo_inicio.slice(0, 4) +
          "/" +
          p.aquisitivo_fim.slice(0, 4),
        dias_direito: p.dias_direito,
        status: p.status,
      })),
      lancamentos: lancsColab.map((l) => ({
        id: l.id,
        periodo_id: l.periodo_id,
        tipo: l.tipo,
        dias: l.dias,
        dias_abono: l.dias_abono ?? 0,
        data_inicio: l.data_inicio,
        data_fim: l.data_fim,
        status: l.status,
        observacao: l.observacao,
      })),
    });
  }

  // Ordena por gravidade: críticas primeiro, dentro de cada grupo por nome.
  const prioridade: Record<NivelPendenciaFerias, number> = {
    critica: 1,
    alerta: 2,
    info: 3,
    ok: 4,
  };
  rows.sort((a, b) => {
    const dp = prioridade[a.nivel] - prioridade[b.nivel];
    if (dp !== 0) return dp;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });

  return <PendenciasListaCliente rows={rows} />;
}
