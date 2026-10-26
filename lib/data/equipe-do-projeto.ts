import { createClient } from "@/lib/supabase/server";
import { jobEstaCongelado, type AppRole, type JobStatus } from "@/lib/types";

/**
 * A Equipe do projeto, como o pop-up "Equipe" mostra (decisão 174).
 *
 * Quem está nela, e por quê. Só os ACRÉSCIMOS manuais são gravados
 * (`projeto_responsaveis`, papel `equipe`); o resto entra sozinho e é
 * derivado aqui, na leitura (decisão 037):
 *
 *  - quem criou o projeto;
 *  - os GPs Responsáveis do projeto (papel `gp`);
 *  - o GP e o Produtor Responsáveis de cada job vivo (decisão 174);
 *  - os produtores dos orçamentos (decisão 037).
 */

type Supabase = ReturnType<typeof createClient>;

export interface PessoaDaEquipe {
  id: string;
  nome: string;
  /** Nulo para quem não é mais membro ativo (continua gravado em algum
   *  job ou na equipe, e aparece com o nome). */
  papel: AppRole | null;
}

export type MotivoNaEquipe =
  | { tipo: "criador" }
  | { tipo: "gp_projeto" }
  | { tipo: "gp_job"; codigos: string[] }
  | { tipo: "produtor_job"; codigos: string[] }
  | { tipo: "produtor_orcamento"; codigos: string[] }
  | { tipo: "acrescimo" };

export interface MembroDaEquipe {
  pessoa: PessoaDaEquipe;
  motivos: MotivoNaEquipe[];
  /** Entrou sozinho: não sai pela Equipe. */
  automatico: boolean;
}

export interface JobNaEquipe {
  id: string;
  codigo: string;
  nome: string;
  gpId: string | null;
  produtorId: string | null;
  /** A chave do envio de PP pelo Produtor Responsável (decisão 174). */
  produtorEnviaPP: boolean;
  /** Os códigos das PPs "prontas para envio" que esperam o GP. Ligar a
   *  chave não as tira da fila dele (22/10/2026): o pop-up avisa. */
  ppsProntas: string[];
  /** Encerrado ou finalizado: não sai mais PP, e a chave fica parada. */
  congelado: boolean;
  /** Aberto ou em produção: o GP e o produtor se trocam pela Equipe
   *  (decisão 176). Antes da abertura, eles mudam no envio para abertura. */
  aceitaTroca: boolean;
}

export interface EquipeDoProjeto {
  projetoId: string;
  projetoCodigo: string;
  projetoNome: string;
  membros: MembroDaEquipe[];
  /** Os jobs vivos do projeto, na ordem de criação. */
  jobs: JobNaEquipe[];
  /** Os acréscimos manuais gravados — o que o "Salvar" reescreve. */
  acrescimos: string[];
  /** Membros ativos que ainda não estão na equipe. */
  candidatos: PessoaDaEquipe[];
}

const ORDEM_DO_MOTIVO: MotivoNaEquipe["tipo"][] = [
  "produtor_job",
  "gp_job",
  "gp_projeto",
  "produtor_orcamento",
  "criador",
  "acrescimo",
];

export async function carregarEquipeDoProjeto(
  supabase: Supabase,
  tenantId: string,
  projetoId: string,
): Promise<EquipeDoProjeto | null> {
  const [projetoRes, vinculosRes, orcsRes, jobsRes, membrosRes, prontasRes] =
    await Promise.all([
      supabase
        .from("projetos")
        .select("id, codigo, nome, created_by")
        .eq("id", projetoId)
        .eq("tenant_id", tenantId)
        .maybeSingle<{
          id: string;
          codigo: string;
          nome: string;
          created_by: string | null;
        }>(),
      supabase
        .from("projeto_responsaveis")
        .select("profile_id, papel")
        .eq("projeto_id", projetoId)
        .eq("tenant_id", tenantId),
      supabase
        .from("orcamentos")
        .select("codigo, produtor_id")
        .eq("projeto_id", projetoId)
        .eq("tenant_id", tenantId)
        .not("produtor_id", "is", null),
      supabase
        .from("jobs")
        .select(
          "id, codigo, nome, status, responsavel_id, produtor_id, produtor_envia_pp",
        )
        .eq("projeto_id", projetoId)
        .eq("tenant_id", tenantId)
        .neq("status", "cancelado")
        .order("created_at", { ascending: true }),
      supabase.rpc("membros_ativos_com_papel", { p_tenant_id: tenantId }),
      supabase
        .from("pedidos_compra")
        .select("codigo, job_id, jobs!inner(projeto_id)")
        .eq("jobs.projeto_id", projetoId)
        .eq("tenant_id", tenantId)
        .eq("status", "gerada")
        .not("pronta_para_envio_em", "is", null)
        .order("codigo", { ascending: true }),
    ]);

  const projeto = projetoRes.data;
  if (!projeto) return null;
  for (const r of [vinculosRes, orcsRes, jobsRes, membrosRes, prontasRes]) {
    if (r.error) console.error("[equipe.carregar]", r.error.message);
  }

  const vinculos = (vinculosRes.data ?? []) as Array<{
    profile_id: string;
    papel: "gp" | "equipe";
  }>;
  const orcamentos = (orcsRes.data ?? []) as Array<{
    codigo: string | null;
    produtor_id: string;
  }>;
  const jobsBrutos = (jobsRes.data ?? []) as Array<{
    id: string;
    codigo: string;
    nome: string;
    responsavel_id: string | null;
    produtor_id: string | null;
    produtor_envia_pp: boolean | null;
    status: JobStatus;
  }>;
  const prontasPorJob = new Map<string, string[]>();
  for (const pp of (prontasRes.data ?? []) as Array<{
    codigo: string;
    job_id: string;
  }>) {
    prontasPorJob.set(pp.job_id, [...(prontasPorJob.get(pp.job_id) ?? []), pp.codigo]);
  }
  const ativos = (
    (membrosRes.data ?? []) as Array<{
      id: string;
      nome: string;
      papel: string;
    }>
  ).map((m): PessoaDaEquipe => ({
    id: m.id,
    nome: m.nome,
    papel: m.papel as AppRole,
  }));

  const motivos = new Map<string, MotivoNaEquipe[]>();
  const add = (id: string | null, m: MotivoNaEquipe) => {
    if (!id) return;
    motivos.set(id, [...(motivos.get(id) ?? []), m]);
  };
  const porPessoa = (lista: Array<[string | null, string]>) => {
    const m = new Map<string, string[]>();
    for (const [id, codigo] of lista)
      if (id) m.set(id, [...(m.get(id) ?? []), codigo]);
    return m;
  };

  add(projeto.created_by, { tipo: "criador" });
  for (const v of vinculos)
    if (v.papel === "gp") add(v.profile_id, { tipo: "gp_projeto" });
  for (const [id, codigos] of porPessoa(
    jobsBrutos.map((j) => [j.responsavel_id, j.codigo]),
  )) {
    add(id, { tipo: "gp_job", codigos });
  }
  for (const [id, codigos] of porPessoa(
    jobsBrutos.map((j) => [j.produtor_id, j.codigo]),
  )) {
    add(id, { tipo: "produtor_job", codigos });
  }
  for (const [id, codigos] of porPessoa(
    orcamentos.map((o) => [o.produtor_id, o.codigo ?? ""]),
  )) {
    add(id, { tipo: "produtor_orcamento", codigos: codigos.filter(Boolean) });
  }
  const acrescimos = vinculos
    .filter((v) => v.papel === "equipe")
    .map((v) => v.profile_id);
  for (const id of acrescimos)
    if (!motivos.has(id)) add(id, { tipo: "acrescimo" });

  // Quem não é mais membro ativo continua com o nome (gravado num job ou
  // na equipe): uma leitura a mais, só quando há alguém assim.
  const ativoPorId = new Map(ativos.map((p) => [p.id, p]));
  const faltam = [...motivos.keys()].filter((id) => !ativoPorId.has(id));
  const inativos = new Map<string, PessoaDaEquipe>();
  if (faltam.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", faltam);
    for (const p of (data ?? []) as Array<{ id: string; nome: string }>) {
      inativos.set(p.id, { id: p.id, nome: p.nome, papel: null });
    }
  }

  const membros: MembroDaEquipe[] = [...motivos.entries()]
    .map(([id, ms]) => ({
      pessoa: ativoPorId.get(id) ??
        inativos.get(id) ?? { id, nome: "—", papel: null },
      motivos: [...ms].sort(
        (a, b) =>
          ORDEM_DO_MOTIVO.indexOf(a.tipo) - ORDEM_DO_MOTIVO.indexOf(b.tipo),
      ),
      automatico: ms.some((m) => m.tipo !== "acrescimo"),
    }))
    .sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));

  return {
    projetoId: projeto.id,
    projetoCodigo: projeto.codigo,
    projetoNome: projeto.nome,
    membros,
    jobs: jobsBrutos.map((j) => ({
      id: j.id,
      codigo: j.codigo,
      nome: j.nome,
      gpId: j.responsavel_id,
      produtorId: j.produtor_id,
      produtorEnviaPP: j.produtor_envia_pp === true,
      ppsProntas: prontasPorJob.get(j.id) ?? [],
      congelado: jobEstaCongelado(j.status),
      aceitaTroca: j.status === "aberto" || j.status === "em_producao",
    })),
    acrescimos,
    candidatos: ativos.filter((p) => !motivos.has(p.id)),
  };
}

/**
 * Os projetos em cuja Equipe a pessoa está — a mesma régua de
 * `carregarEquipeDoProjeto`, lida pelo outro lado (de uma pessoa para os
 * projetos, e não de um projeto para as pessoas). É o recorte "Meus" da
 * lista de Jobs (16/10/2026): todo job do projeto é "meu" para quem está
 * na Equipe dele, e não só para o GP e o Produtor Responsáveis do job.
 *
 * Quatro leituras já filtradas por ela, em paralelo: voltam poucas linhas.
 * Mudou quem entra sozinho na Equipe? Mude aqui também.
 */
export async function projetosNaEquipeDe(
  supabase: Supabase,
  tenantId: string,
  profileId: string,
): Promise<Set<string>> {
  const [criouRes, vinculosRes, orcsRes, jobsRes] = await Promise.all([
    supabase
      .from("projetos")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("created_by", profileId),
    // GP do projeto e acréscimo manual: qualquer papel vale.
    supabase
      .from("projeto_responsaveis")
      .select("projeto_id")
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId),
    supabase
      .from("orcamentos")
      .select("projeto_id")
      .eq("tenant_id", tenantId)
      .eq("produtor_id", profileId),
    supabase
      .from("jobs")
      .select("projeto_id")
      .eq("tenant_id", tenantId)
      .or(`responsavel_id.eq.${profileId},produtor_id.eq.${profileId}`)
      .neq("status", "cancelado"),
  ]);
  for (const r of [criouRes, vinculosRes, orcsRes, jobsRes]) {
    if (r.error) console.error("[equipe.projetosDe]", r.error.message);
  }

  const ids = new Set<string>();
  for (const p of (criouRes.data ?? []) as Array<{ id: string }>) ids.add(p.id);
  for (const r of [vinculosRes, orcsRes, jobsRes]) {
    for (const l of (r.data ?? []) as Array<{ projeto_id: string | null }>) {
      if (l.projeto_id) ids.add(l.projeto_id);
    }
  }
  return ids;
}

/** A Equipe a partir do job — a página do job a lê junto do detalhe, sem
 *  esperar o projeto chegar por ele. */
export async function carregarEquipeDoJob(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
): Promise<EquipeDoProjeto | null> {
  const { data } = await supabase
    .from("jobs")
    .select("projeto_id")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string | null }>();
  if (!data?.projeto_id) return null;
  return carregarEquipeDoProjeto(supabase, tenantId, data.projeto_id);
}
