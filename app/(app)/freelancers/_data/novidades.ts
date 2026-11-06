/**
 * Carrega as listas de "Novidades" do dashboard do /freelancers.
 *
 * Filtros gerais:
 *   - Cutoff: só itens com data a partir de 2026-10-20 (primeira migração dos
 *     legados do AgCaliforniaRH). Backlog antigo não polui.
 *   - Freelancers com origem='migracao' nunca aparecem (vieram do import, não
 *     são novidade).
 *   - Contratos com origem_sistema='ag_california_rh' nunca aparecem (idem).
 *
 * As categorias:
 *   1. distratos: GP pediu distrato, RH ainda não gerou minuta
 *   2. distratos_aguardando_assinatura: minuta de distrato gerada, falta
 *      anexar PDF assinado pra aplicar a antecipação
 *   3. contratacoes: freela preencheu form público (primeiro contrato)
 *   4. renovacoes: solicitação de renovação virou contrato (freela já existia)
 *
 * Contratações e renovações saem da MESMA query (freelancer_solicitacoes com
 * contrato_id já criado); a distinção vem da contagem de contratos do freela.
 * Seções removidas por não agregarem valor: "Aditivos" (redundante com
 * renovações da solicitação), "Novos cadastros" (todo freela nasce de
 * solicitação) e "Preenchimentos" (base sem legados pendentes de job).
 */

import { contratoDispensaMinuta } from "@/lib/utils";
import type { createClient } from "@/lib/supabase/server";
import type {
  DistratoSolicitadoItem,
  SolicitacaoConcluidaItem,
} from "../_components/novidades-pill";

export const CUTOFF_NOVIDADES = "2026-10-20T00:00:00.000Z";

export interface DadosNovidades {
  distratos: DistratoSolicitadoItem[];
  distratos_aguardando_assinatura: DistratoSolicitadoItem[];
  contratacoes: SolicitacaoConcluidaItem[];
  renovacoes: SolicitacaoConcluidaItem[];
  dismissedIds: string[];
}

export async function carregarNovidades(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<DadosNovidades> {
  const [
    distratosRaw,
    distratosAguardandoRaw,
    concluidasRaw,
    dismissedRes,
  ] = await Promise.all([
    // 1. Distratos solicitados pendentes (falta gerar minuta)
    supabase
      .from("freelancer_contratos")
      .select(
        "id, freelancer_id, nome_job, cargo, distrato_solicitado_em, distrato_solicitado_por, distrato_data_proposta, freelancers!inner(nome_social, nome_completo)",
      )
      .eq("tenant_id", tenantId)
      .not("distrato_solicitado_em", "is", null)
      .is("distrato_minuta_url", null)
      .is("distrato_arquivo_url", null)
      .gte("distrato_solicitado_em", CUTOFF_NOVIDADES)
      .order("distrato_solicitado_em", { ascending: false })
      .limit(50),

    // 2. Distratos com minuta gerada, aguardando PDF assinado do freela.
    //    A antecipação só é APLICADA quando o PDF é anexado — enquanto isso,
    //    o contrato segue com data_termino original. Sem essa seção, o fluxo
    //    ficava invisível entre "gerar minuta" e "anexar PDF" (ex.: RH que
    //    gera a minuta e esquece de cobrar o assinado).
    supabase
      .from("freelancer_contratos")
      .select(
        "id, freelancer_id, nome_job, cargo, distrato_solicitado_em, distrato_solicitado_por, distrato_data_proposta, freelancers!inner(nome_social, nome_completo)",
      )
      .eq("tenant_id", tenantId)
      .not("distrato_minuta_url", "is", null)
      .is("distrato_arquivo_url", null)
      .gte("distrato_solicitado_em", CUTOFF_NOVIDADES)
      .order("distrato_solicitado_em", { ascending: false })
      .limit(50),

    // 5. Solicitações concluídas = cadastrada (falta gerar minuta) ou
    //    finalizada (minuta gerada / dispensa). Juntos no mesmo card porque
    //    ambos representam "freela já no sistema, última ponta pendente".
    //    nome_job é fallback pros registros migrados do RH antigo (sem FK).
    //    Sem embed de job/job_interno — lookup separado em concluidasJobsRes
    //    abaixo (evita o bug de schema cache stale do PostgREST com embed
    //    polimórfico, 29/10/2026).
    //
    //    Limit 300: essa lista alimenta o dedup de "Novos cadastros" (freela
    //    com solicitação concluída some de Novos). Se a solicitação do freela
    //    cair fora do top-N por ordem de updated_at (ex.: após um backfill
    //    em massa que empatou timestamps), o dedup falha e o freela
    //    reaparece em Novos. Mantém folga alta pra evitar isso.
    // Solicitações com contrato já criado = evento aconteceu (freela
    // preencheu form OU renovação aprovada). Filtro por contrato_id NOT NULL
    // + status (aprovada, cadastrada, finalizada):
    //   - aprovada + contrato = renovação já aprovada, aguarda minuta
    //   - cadastrada = contratação, freela preencheu form
    //   - finalizada = minuta pronta OU dispensa
    // Exclui: aprovada sem contrato (contratação aguardando freela — nada
    // novo pra Maria), pendente, rejeitada, cancelada.
    supabase
      .from("freelancer_solicitacoes")
      .select(
        "id, freelancer_id, contrato_id, nome_freela, cargo, updated_at, nome_job, job_id, job_interno_id, status, tipo, data_inicio, data_termino, solicitante:profiles!solicitante_id(nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aprovada", "cadastrada", "finalizada"])
      .not("contrato_id", "is", null)
      .gte("updated_at", CUTOFF_NOVIDADES)
      .order("updated_at", { ascending: false })
      .limit(300),

    // Pool global de dismissed
    supabase
      .from("notificacoes_dismissed")
      .select("notification_id")
      .eq("tenant_id", tenantId),
  ]);

  // Pra Distratos (duas seções): nome do solicitante
  const distratosRawData = (distratosRaw.data ?? []) as any[];
  const distratosAguardandoData = (distratosAguardandoRaw.data ?? []) as any[];
  const solicitadoPorIds = Array.from(
    new Set(
      [...distratosRawData, ...distratosAguardandoData]
        .map((d) => d.distrato_solicitado_por)
        .filter(Boolean),
    ),
  );
  const distratosProfiles = new Map<string, string>();
  if (solicitadoPorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", solicitadoPorIds);
    for (const p of (profs ?? []) as Array<{ id: string; nome: string }>) {
      distratosProfiles.set(p.id, p.nome);
    }
  }
  const mapearDistrato = (d: any): DistratoSolicitadoItem => {
    const freela = Array.isArray(d.freelancers)
      ? d.freelancers[0]
      : d.freelancers;
    return {
      contrato_id: d.id,
      freelancer_id: d.freelancer_id,
      freelancer_nome: freela?.nome_completo ?? freela?.nome_social ?? "—",
      nome_job: d.nome_job,
      cargo: d.cargo,
      solicitado_em: d.distrato_solicitado_em,
      solicitado_por_nome: d.distrato_solicitado_por
        ? (distratosProfiles.get(d.distrato_solicitado_por) ?? null)
        : null,
      data_proposta: d.distrato_data_proposta,
    };
  };
  const distratos: DistratoSolicitadoItem[] = distratosRawData
    .filter((d) => d.nome_job)
    .map(mapearDistrato);
  const distratosAguardandoAssinatura: DistratoSolicitadoItem[] =
    distratosAguardandoData.filter((d) => d.nome_job).map(mapearDistrato);

  // Lookup dos nomes de job pras concluídas (produção + internos).
  const concluidasBrutas = (concluidasRaw.data ?? []) as any[];
  const concluidasJobIds = Array.from(
    new Set(
      concluidasBrutas
        .map((s) => s.job_id as string | null)
        .filter((id): id is string => !!id),
    ),
  );
  const concluidasJobInternoIds = Array.from(
    new Set(
      concluidasBrutas
        .map((s) => s.job_interno_id as string | null)
        .filter((id): id is string => !!id),
    ),
  );
  const [concluidasJobsRes, concluidasInternosRes] = await Promise.all([
    concluidasJobIds.length > 0
      ? supabase
          .from("jobs")
          .select("id, nome")
          .in("id", concluidasJobIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    concluidasJobInternoIds.length > 0
      ? supabase
          .from("freelancer_jobs_internos")
          .select("id, nome")
          .in("id", concluidasJobInternoIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const concluidasJobsMap = new Map<string, string>();
  for (const j of (concluidasJobsRes.data ?? []) as any[]) {
    concluidasJobsMap.set(j.id, j.nome);
  }
  const concluidasInternosMap = new Map<string, string>();
  for (const j of (concluidasInternosRes.data ?? []) as any[]) {
    concluidasInternosMap.set(j.id, j.nome);
  }

  // Lookup pra preferir nome_completo do cadastro em vez do texto que o
  // solicitante digitou (geralmente apelido tipo "Nat", "Tata").
  const concluidasFreelaIds = Array.from(
    new Set(
      concluidasBrutas
        .map((s) => s.freelancer_id as string | null)
        .filter((id): id is string => !!id),
    ),
  );
  const concluidasFreelaNomes = new Map<string, string>();
  if (concluidasFreelaIds.length > 0) {
    const { data: freelas } = await supabase
      .from("freelancers")
      .select("id, nome_social, nome_completo")
      .in("id", concluidasFreelaIds);
    for (const f of (freelas ?? []) as Array<{
      id: string;
      nome_social: string;
      nome_completo: string | null;
    }>) {
      concluidasFreelaNomes.set(f.id, f.nome_completo || f.nome_social);
    }
  }

  // Pra decidir contratação × renovação: conta contratos efetivos (nome_job
  // preenchido) por freela. count ≥ 2 = renovação; count = 1 = contratação
  // nova. Mesma regra usada em /freelancers/solicitacoes (page.tsx).
  const contratosPorFreela = new Map<string, number>();
  if (concluidasFreelaIds.length > 0) {
    const { data: contRows } = await supabase
      .from("freelancer_contratos")
      .select("freelancer_id")
      .eq("tenant_id", tenantId)
      .in("freelancer_id", concluidasFreelaIds)
      .not("nome_job", "is", null);
    for (const r of (contRows ?? []) as Array<{ freelancer_id: string }>) {
      contratosPorFreela.set(
        r.freelancer_id,
        (contratosPorFreela.get(r.freelancer_id) ?? 0) + 1,
      );
    }
  }

  const concluidas: SolicitacaoConcluidaItem[] = concluidasBrutas.map((s) => {
    const dispensa = contratoDispensaMinuta(
      s.tipo,
      s.data_inicio,
      s.data_termino,
    );
    return {
      solicitacao_id: s.id,
      freelancer_id: s.freelancer_id,
      freelancer_nome:
        (s.freelancer_id
          ? concluidasFreelaNomes.get(s.freelancer_id)
          : undefined) ?? s.nome_freela,
      nome_job:
        (s.job_id ? concluidasJobsMap.get(s.job_id) : undefined) ??
        (s.job_interno_id
          ? concluidasInternosMap.get(s.job_interno_id)
          : undefined) ??
        s.nome_job ??
        "—",
      cargo: s.cargo,
      solicitante_nome: s.solicitante?.nome ?? null,
      atualizado_em: s.updated_at,
      status: s.status as "aprovada" | "cadastrada" | "finalizada",
      tipo_contrato: s.tipo as "mensal" | "periodo" | "diarias" | null,
      dispensa_minuta: dispensa,
    };
  });


  // Separa em contratações (freela novo, count=1) vs renovações (count≥2).
  // Regra: um freela tem contratação se é o primeiro contrato dele; renovação
  // se já tem outros. Como o próprio contrato da solicitação conta em
  // contratosPorFreela, "primeiro" = count == 1.
  const contratacoes: SolicitacaoConcluidaItem[] = [];
  const renovacoes: SolicitacaoConcluidaItem[] = [];
  for (const c of concluidas) {
    const n = c.freelancer_id
      ? (contratosPorFreela.get(c.freelancer_id) ?? 0)
      : 0;
    if (n >= 2) {
      renovacoes.push(c);
    } else {
      contratacoes.push(c);
    }
  }

  const dismissedIds = (
    (dismissedRes.data ?? []) as Array<{ notification_id: string }>
  ).map((r) => r.notification_id);

  return {
    distratos,
    distratos_aguardando_assinatura: distratosAguardandoAssinatura,
    contratacoes,
    renovacoes,
    dismissedIds,
  };
}

/** Carrega a lista de lookup pro Buscar freelancer. */
export async function carregarFreelancersLookup(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
) {
  const { data } = await supabase
    .from("freelancers_lookup")
    .select(
      "id, nome_social, nome_completo, cargo_contrato, nome_job, responsavel_id, responsavel_nome, status_vinculo",
    )
    .eq("tenant_id", tenantId)
    .order("nome_social", { ascending: true });
  return data ?? [];
}
