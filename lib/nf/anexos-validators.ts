/**
 * Lógica pura de validação e resolução de escopo para NF de colaborador.
 *
 * Sem importações de Next.js, React, Supabase server ou qualquer módulo com
 * efeitos colaterais — pode ser importada em testes Node.js sem mocks adicionais.
 *
 * `anexos-actions.ts` importa deste módulo e injeta o client real de Supabase.
 */

import type { NfAnexoEscopo } from "@/lib/nf/anexos-escopo";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface EscopoResolvido {
  colaboradorId: string;
  competenciaAno: number;
  competenciaMes: number;
}

/**
 * Subconjunto mínimo do client Supabase usado pelos resolvers.
 * Definido estruturalmente para permitir DI em testes sem importar o módulo
 * server do Supabase.
 *
 * `maybeSingle` retorna `any` pois o tipo real é `PostgrestBuilder` (não um
 * `Promise` plain) — a interface é suficientemente larga para aceitar ambos.
 */
export interface SupabaseQueryClient {
  from(table: string): any;
}

// ---------------------------------------------------------------------------
// Resolvers (aceitam cliente via parâmetro — testável por injeção)
// ---------------------------------------------------------------------------

export async function resolverFolhaMensal(
  supabase: SupabaseQueryClient,
  tenantId: string,
  escopoId: string,
): Promise<EscopoResolvido | null> {
  const { data } = await supabase
    .from("folhas_pagamento")
    .select("colaborador_id, competencia_ano, competencia_mes")
    .eq("id", escopoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return {
    colaboradorId: data.colaborador_id as string,
    competenciaAno: data.competencia_ano as number,
    competenciaMes: data.competencia_mes as number,
  };
}

export async function resolverFeriasLancamento(
  supabase: SupabaseQueryClient,
  tenantId: string,
  escopoId: string,
): Promise<EscopoResolvido | null> {
  const { data } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("colaborador_id, data_inicio")
    .eq("id", escopoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const d = new Date(data.data_inicio as string);
  return {
    colaboradorId: data.colaborador_id as string,
    competenciaAno: d.getUTCFullYear(),
    competenciaMes: d.getUTCMonth() + 1,
  };
}

/** Resolves decimo_terceiro_linhas; join via select string retorna objeto aninhado. */
export async function resolverDecimoTerceiroLinha(
  supabase: SupabaseQueryClient,
  tenantId: string,
  escopoId: string,
  escopo: "decimo_terceiro_p1" | "decimo_terceiro_p2",
): Promise<EscopoResolvido | null> {
  // O join Supabase retorna `folhas_decimo_terceiro` como objeto aninhado.
  // A interface SupabaseQueryClient usa `Record<string,unknown>`, então o cast
  // para `any` aqui é necessário — o schema garante a FK.
  const { data } = await supabase
    .from("decimo_terceiro_linhas")
    .select("colaborador_id, folha_id, folhas_decimo_terceiro!inner(ano)")
    .eq("id", escopoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const folha = (data as any).folhas_decimo_terceiro as { ano: number } | null;
  if (!folha) return null;
  return {
    colaboradorId: data.colaborador_id as string,
    competenciaAno: folha.ano,
    competenciaMes: escopo === "decimo_terceiro_p1" ? 11 : 12,
  };
}

export async function resolverEscopo(
  supabase: SupabaseQueryClient,
  tenantId: string,
  escopoTipo: NfAnexoEscopo,
  escopoId: string,
): Promise<EscopoResolvido | null> {
  switch (escopoTipo) {
    case "folha_mensal":
      return resolverFolhaMensal(supabase, tenantId, escopoId);
    case "ferias_usufruto":
    case "ferias_abono":
      return resolverFeriasLancamento(supabase, tenantId, escopoId);
    case "decimo_terceiro_p1":
    case "decimo_terceiro_p2":
      return resolverDecimoTerceiroLinha(supabase, tenantId, escopoId, escopoTipo);
    case "decimo_terceiro_adiantamento":
      return resolverDecimoTerceiroAdiantamento(supabase, tenantId, escopoId);
  }
}

export async function resolverDecimoTerceiroAdiantamento(
  supabase: SupabaseQueryClient,
  tenantId: string,
  escopoId: string,
): Promise<EscopoResolvido | null> {
  const { data } = await supabase
    .from("decimo_terceiro_adiantamentos")
    .select("colaborador_id, ano")
    .eq("id", escopoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return {
    colaboradorId: data.colaborador_id as string,
    competenciaAno: data.ano as number,
    competenciaMes: 12,
  };
}

// ---------------------------------------------------------------------------
// Validação pura de acesso (sem I/O)
// ---------------------------------------------------------------------------

/**
 * Verifica se a sessão tem acesso à NF do colaborador.
 *
 * Regra: dono do recurso (`userIdColaborador === userIdSessao`) OU
 * papel com alçada `rh.nf.anexar_qualquer`.
 *
 * Retorna `{ ok: false, message }` quando nenhuma das condições for satisfeita
 * — a mensagem é usada diretamente pela action.
 */
export function validarAcessoAnexo(params: {
  temAlcada: boolean;
  userIdSessao: string;
  userIdColaborador: string | null | undefined;
}): { ok: true } | { ok: false; message: string } {
  if (params.temAlcada) return { ok: true };
  if (params.userIdColaborador && params.userIdColaborador === params.userIdSessao) {
    return { ok: true };
  }
  return { ok: false, message: "Não é o colaborador dono desse escopo." };
}
