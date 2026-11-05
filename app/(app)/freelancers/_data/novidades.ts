/**
 * Carrega as 5 listas de "Novidades" do dashboard do /freelancers.
 *
 * Filtros gerais:
 *   - Cutoff: só itens com data a partir de 2026-10-20 (primeira migração dos
 *     legados do AgCaliforniaRH). Backlog antigo não polui.
 *   - Freelancers com origem='migracao' nunca aparecem (vieram do import, não
 *     são novidade).
 *   - Contratos com origem_sistema='ag_california_rh' nunca aparecem (idem).
 *
 * As 5 categorias:
 *   1. novos: freelas criados após cutoff (manual ou form_publico)
 *   2. aditivos: novos contratos em freelas já existentes, sem PDF
 *   3. preenchimentos: stubs que ganharam nome_job (via histórico)
 *   4. distratos: GP pediu distrato, RH ainda não gerou minuta
 *   5. concluidas: solicitação cadastrada, falta anexar PDF
 */

import type { createClient } from "@/lib/supabase/server";
import type {
  NovoCadastroItem,
  AditivoItem,
  PreenchimentoItem,
  DistratoSolicitadoItem,
  SolicitacaoConcluidaItem,
} from "../_components/novidades-pill";

export const CUTOFF_NOVIDADES = "2026-10-20T00:00:00.000Z";

export interface DadosNovidades {
  novos: NovoCadastroItem[];
  aditivos: AditivoItem[];
  preenchimentos: PreenchimentoItem[];
  distratos: DistratoSolicitadoItem[];
  concluidas: SolicitacaoConcluidaItem[];
  dismissedIds: string[];
}

export async function carregarNovidades(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<DadosNovidades> {
  const [
    novosRes,
    aditivosRaw,
    preenchimentosRaw,
    distratosRaw,
    concluidasRaw,
    dismissedRes,
  ] = await Promise.all([
    // 1. Novos cadastros
    supabase
      .from("freelancers")
      .select("id, nome_social, nome_completo, created_at, origem")
      .eq("tenant_id", tenantId)
      .in("origem", ["manual", "form_publico"])
      .gte("created_at", CUTOFF_NOVIDADES)
      .order("created_at", { ascending: false })
      .limit(50),

    // 2. Aditivos: contratos criados após cutoff, sem PDF, com nome_job,
    // em freelas que já têm algum contrato (count > 1).
    //
    // Sem filtro de origem_sistema (30/10/2026): o filtro `= califa_erp`
    // excluía todo contrato vindo da migração do RH antigo. Como o RH
    // continua operando lá no antigo e os aditivos chegam pelo sync, nada
    // aparecia no card. O cutoff já faz o papel de "só coisas novas".
    //
    // Depois do fluxo novo de renovação (03/11/2026), aprovar uma
    // solicitação de renovação cria o contrato na hora — então essas
    // renovações caem naturalmente neste card como "contrato sem PDF".
    // Sem necessidade de misturar fontes.
    supabase
      .from("freelancer_contratos")
      .select(
        "id, freelancer_id, nome_job, cargo, created_at, data_termino, arquivo_url, freelancers!inner(nome_social, nome_completo)",
      )
      .eq("tenant_id", tenantId)
      .is("arquivo_url", null)
      .not("nome_job", "is", null)
      .gte("created_at", CUTOFF_NOVIDADES)
      .order("created_at", { ascending: false })
      .limit(100),

    // 3. Preenchimentos: histórico de mudanças onde nome_job foi preenchido
    supabase
      .from("freelancer_contrato_historico")
      .select(
        "contrato_id, valor_novo, alterado_em, alterado_por, freelancer_contratos!inner(freelancer_id, nome_job, cargo, freelancers!inner(nome_social, nome_completo))",
      )
      .eq("tenant_id", tenantId)
      .eq("campo", "nome_job")
      .is("valor_anterior", null)
      .not("valor_novo", "is", null)
      .gte("alterado_em", CUTOFF_NOVIDADES)
      .order("alterado_em", { ascending: false })
      .limit(50),

    // 4. Distratos solicitados pendentes
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

    // 5. Solicitações concluídas = cadastrada (falta gerar minuta) ou
    //    finalizada (minuta gerada / dispensa). Juntos no mesmo card porque
    //    ambos representam "freela já no sistema, última ponta pendente".
    //    nome_job é fallback pros registros migrados do RH antigo (sem FK).
    //    Sem embed de job/job_interno — lookup separado em concluidasJobsRes
    //    abaixo (evita o bug de schema cache stale do PostgREST com embed
    //    polimórfico, 29/10/2026).
    supabase
      .from("freelancer_solicitacoes")
      .select(
        "id, freelancer_id, contrato_id, nome_freela, cargo, updated_at, nome_job, job_id, job_interno_id, solicitante:profiles!solicitante_id(nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["cadastrada", "finalizada"])
      .gte("updated_at", CUTOFF_NOVIDADES)
      .order("updated_at", { ascending: false })
      .limit(50),

    // Pool global de dismissed
    supabase
      .from("notificacoes_dismissed")
      .select("notification_id")
      .eq("tenant_id", tenantId),
  ]);

  const novos: NovoCadastroItem[] = (novosRes.data ?? []).map((f: any) => ({
    id: f.id,
    // Prefere nome_completo; cai pro nome_social quando o completo está vazio.
    nome_social: f.nome_completo || f.nome_social,
    created_at: f.created_at,
    origem: f.origem,
  }));

  // Pra Aditivos: filtrar por freelas que têm > 1 contrato efetivo
  const contratosRaw = (aditivosRaw.data ?? []) as any[];
  const freelasIds = Array.from(
    new Set(contratosRaw.map((c) => c.freelancer_id)),
  );
  let aditivos: AditivoItem[] = [];
  if (freelasIds.length > 0) {
    const { data: countRows } = await supabase
      .from("freelancer_contratos")
      .select("freelancer_id")
      .eq("tenant_id", tenantId)
      .in("freelancer_id", freelasIds)
      .not("nome_job", "is", null);
    const porFreela = new Map<string, number>();
    for (const r of (countRows ?? []) as Array<{ freelancer_id: string }>) {
      porFreela.set(r.freelancer_id, (porFreela.get(r.freelancer_id) ?? 0) + 1);
    }
    const hojeISO = new Date().toISOString().slice(0, 10);
    aditivos = contratosRaw
      .filter((c) => {
        if ((porFreela.get(c.freelancer_id) ?? 0) < 2) return false;
        if (c.data_termino && c.data_termino < hojeISO) return false;
        return true;
      })
      .map((c) => {
        const freela = Array.isArray(c.freelancers)
          ? c.freelancers[0]
          : c.freelancers;
        return {
          contrato_id: c.id,
          freelancer_id: c.freelancer_id,
          freelancer_nome: freela?.nome_completo ?? freela?.nome_social ?? "—",
          nome_job: c.nome_job,
          cargo: c.cargo,
          created_at: c.created_at,
        };
      });
  }

  // Pra Preenchimentos: buscar nome do profile alterador separado
  const preenchRaw = (preenchimentosRaw.data ?? []) as any[];
  const alteradoPorIds = Array.from(
    new Set(preenchRaw.map((p) => p.alterado_por).filter(Boolean)),
  );
  const profilesMap = new Map<string, string>();
  if (alteradoPorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", alteradoPorIds);
    for (const p of (profs ?? []) as Array<{ id: string; nome: string }>) {
      profilesMap.set(p.id, p.nome);
    }
  }
  const preenchimentos: PreenchimentoItem[] = preenchRaw
    .map((p) => {
      const contrato = Array.isArray(p.freelancer_contratos)
        ? p.freelancer_contratos[0]
        : p.freelancer_contratos;
      if (!contrato || !p.valor_novo) return null;
      const freela = Array.isArray(contrato.freelancers)
        ? contrato.freelancers[0]
        : contrato.freelancers;
      return {
        contrato_id: p.contrato_id,
        freelancer_id: contrato.freelancer_id,
        freelancer_nome: freela?.nome_completo ?? freela?.nome_social ?? "—",
        nome_job: p.valor_novo,
        cargo: contrato.cargo,
        alterado_em: p.alterado_em,
        alterado_por_nome: p.alterado_por
          ? (profilesMap.get(p.alterado_por) ?? null)
          : null,
      };
    })
    .filter((p): p is PreenchimentoItem => p !== null);

  // Pra Distratos: nome do solicitante
  const distratosRawData = (distratosRaw.data ?? []) as any[];
  const solicitadoPorIds = Array.from(
    new Set(
      distratosRawData.map((d) => d.distrato_solicitado_por).filter(Boolean),
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
  const distratos: DistratoSolicitadoItem[] = distratosRawData
    .filter((d) => d.nome_job)
    .map((d) => {
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
    });

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

  const concluidas: SolicitacaoConcluidaItem[] = concluidasBrutas.map((s) => ({
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
  }));

  // Dedup: freela cadastrado via form público gera DOIS sinais — cadastro novo
  // em `novos` e solicitação com status `cadastrada` em `concluidas`. A seção
  // de "Solicitações concluídas" tem mais contexto (job, cargo, solicitante),
  // então remove o duplicado de "Novos cadastros". Cadastros via `manual`
  // (sem solicitação) seguem aparecendo só em "Novos cadastros".
  const freelasEmConcluidas = new Set(
    concluidas
      .map((c) => c.freelancer_id)
      .filter((id): id is string => !!id),
  );
  const novosSemDup = novos.filter((n) => !freelasEmConcluidas.has(n.id));

  // Renovação aprovada via solicitação cria o contrato na hora — cai em
  // `aditivos` (freela já tinha outro contrato, count ≥ 2) E em `concluidas`
  // (solicitação status=cadastrada). Semanticamente é uma renovação, então
  // prefere "Aditivos". Contratação nova (count=1) não entra em aditivos,
  // segue só em concluídas. Dedup por `contrato_id` da solicitação.
  const contratosEmAditivos = new Set(aditivos.map((a) => a.contrato_id));
  const contratoIdPorSolicitacao = new Map<string, string>();
  for (const raw of concluidasBrutas) {
    if (raw.contrato_id) contratoIdPorSolicitacao.set(raw.id, raw.contrato_id);
  }
  const concluidasSemDup = concluidas.filter((c) => {
    const contratoId = contratoIdPorSolicitacao.get(c.solicitacao_id);
    return !contratoId || !contratosEmAditivos.has(contratoId);
  });

  const dismissedIds = (
    (dismissedRes.data ?? []) as Array<{ notification_id: string }>
  ).map((r) => r.notification_id);

  return {
    novos: novosSemDup,
    aditivos,
    preenchimentos,
    distratos,
    concluidas: concluidasSemDup,
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
