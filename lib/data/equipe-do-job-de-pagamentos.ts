import { createClient } from "@/lib/supabase/server";
import { jobEstaCongelado, type AppRole, type JobStatus } from "@/lib/types";
import type { PessoaDaEquipe } from "@/lib/data/equipe-do-projeto";

/**
 * A Equipe do job de pagamentos (decisão 282), como o pop-up "Equipe" e o
 * formulário de criação mostram.
 *
 * Diferente da Equipe do projeto (decisão 174): é de CADA job
 * (`jobs_equipe_de_pagamentos`), não tem quem entre sozinho (o job não tem
 * GP nem Produtor Responsável, decisão 266) e cada produtor tem a chave
 * "Envia PP". Só se grava pela função `salvar_equipe_do_job_de_pagamentos`.
 */

type Supabase = ReturnType<typeof createClient>;

/** Quem pode entrar na equipe: a produção (o financeiro não gera PP). */
export const PAPEIS_DA_EQUIPE_DE_PAGAMENTOS: readonly AppRole[] = [
  "administrador",
  "gerente_producao",
  "produtor",
  "freelancer",
];

export interface MembroDaEquipeDePagamentos {
  pessoa: PessoaDaEquipe;
  /** A chave "Envia PP" (só vale para o produtor). */
  enviaPP: boolean;
}

export interface EquipeDoJobDePagamentos {
  jobId: string;
  codigo: string;
  nome: string;
  nomeFinanceiro: string;
  /** Quem criou o job: muda a equipe mesmo sem o papel. */
  criadoPor: string | null;
  /** Encerrado, finalizado ou cancelado: a equipe não muda mais. */
  congelado: boolean;
  membros: MembroDaEquipeDePagamentos[];
  /** A produção ativa do tenant — a lista do "+ Adicionar pessoas". */
  candidatos: PessoaDaEquipe[];
}

/** Os membros ativos que podem entrar numa equipe de job de pagamentos.
 *  Também serve ao formulário de criação, que ainda não tem job. */
export async function candidatosDaEquipeDePagamentos(
  supabase: Supabase,
  tenantId: string,
): Promise<PessoaDaEquipe[]> {
  const { data, error } = await supabase.rpc("membros_ativos_com_papel", {
    p_tenant_id: tenantId,
  });
  if (error) console.error("[equipe-pagamentos.candidatos]", error.message);
  return ((data ?? []) as Array<{ id: string; nome: string; papel: string }>)
    .filter((m) => PAPEIS_DA_EQUIPE_DE_PAGAMENTOS.includes(m.papel as AppRole))
    .map((m) => ({ id: m.id, nome: m.nome, papel: m.papel as AppRole }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * A equipe do job, ou null quando o job não é de pagamentos (a página do
 * job chama para todo job: uma leitura só, pequena, nos outros).
 */
export async function carregarEquipeDoJobDePagamentos(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
): Promise<EquipeDoJobDePagamentos | null> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, codigo, nome, nome_financeiro, status, created_by, de_pagamentos")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      codigo: string;
      nome: string;
      nome_financeiro: string | null;
      status: JobStatus;
      created_by: string | null;
      de_pagamentos: boolean;
    }>();
  if (!job || job.de_pagamentos !== true) return null;

  const [linhasRes, candidatos] = await Promise.all([
    supabase
      .from("jobs_equipe_de_pagamentos")
      .select("profile_id, envia_pp")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    candidatosDaEquipeDePagamentos(supabase, tenantId),
  ]);
  if (linhasRes.error) console.error("[equipe-pagamentos.carregar]", linhasRes.error.message);
  const linhas = (linhasRes.data ?? []) as Array<{ profile_id: string; envia_pp: boolean }>;

  // Quem saiu do tenant (ou mudou para um papel fora da produção) continua
  // com o nome: uma leitura a mais, só quando há alguém assim.
  const ativoPorId = new Map(candidatos.map((p) => [p.id, p]));
  const faltam = linhas.map((l) => l.profile_id).filter((id) => !ativoPorId.has(id));
  const fora = new Map<string, PessoaDaEquipe>();
  if (faltam.length > 0) {
    const { data } = await supabase.from("profiles").select("id, nome").in("id", faltam);
    for (const p of (data ?? []) as Array<{ id: string; nome: string }>) {
      fora.set(p.id, { id: p.id, nome: p.nome, papel: null });
    }
  }

  const membros = linhas
    .map((l) => ({
      pessoa: ativoPorId.get(l.profile_id) ??
        fora.get(l.profile_id) ?? { id: l.profile_id, nome: "—", papel: null },
      enviaPP: l.envia_pp === true,
    }))
    .sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));

  return {
    jobId: job.id,
    codigo: job.codigo,
    nome: job.nome,
    // No Financeiro o job se chama pelo nome do financeiro (regra do
    // sistema); no job de pagamentos os dois nascem iguais.
    nomeFinanceiro: job.nome_financeiro ?? job.nome,
    criadoPor: job.created_by,
    congelado: jobEstaCongelado(job.status),
    membros,
    candidatos,
  };
}

/**
 * Os produtores da equipe do job de pagamentos com a chave "Envia PP"
 * ligada — o `enviam_pela_equipe` de `JobParaEnvioDePP` (decisão 282).
 * Só se chama para job de pagamentos; nos outros a lista é vazia.
 */
export async function quemEnviaPelaEquipeDePagamentos(
  supabase: Supabase,
  jobId: string,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("jobs_equipe_de_pagamentos")
    .select("profile_id")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .eq("envia_pp", true);
  if (error) console.error("[equipe-pagamentos.enviam]", error.message);
  return ((data ?? []) as Array<{ profile_id: string }>).map((l) => l.profile_id);
}
