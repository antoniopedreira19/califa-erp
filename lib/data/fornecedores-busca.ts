import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A busca de fornecedor por digitação (decisão 255, 12/11/2026).
 *
 * Os combos de fornecedor (PP, BV, campo do financeiro) recebiam o cadastro
 * inteiro na carga da página. Com mais de 1.000 ativos o PostgREST corta a
 * lista em silêncio, e o docs/PERFORMANCE.md já proíbe carregar cadastro que
 * cresce inteiro num select. Agora a tela manda só os fornecedores que já
 * aparecem nela, e o combo busca o resto no servidor enquanto a pessoa
 * digita — pela função `buscar_fornecedores` (sem acento, por nome, razão
 * social ou documento, os que começam pelo termo primeiro).
 */

/** O que o combo precisa de cada fornecedor achado. É o mesmo formato do
 *  `FornecedorResumo` do cadastro rápido. */
export interface FornecedorDaBusca {
  id: string;
  nome: string;
  razao_social: string | null;
  status: "ativo" | "inativo";
  cpf_cnpj: string | null;
}

/** Quantos a busca devolve por vez. Termo vazio: os primeiros em ordem
 *  alfabética, para o combo abrir cheio. */
export const LIMITE_DA_BUSCA_DE_FORNECEDORES = 30;

/** Até onde o termo vai ao banco. */
export const TERMO_MAXIMO_DA_BUSCA = 100;

export async function buscarFornecedoresAtivos(
  supabase: SupabaseClient,
  tenantId: string,
  termo: string,
): Promise<{ ok: true; fornecedores: FornecedorDaBusca[] } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("buscar_fornecedores", {
    p_tenant_id: tenantId,
    p_termo: termo.trim().slice(0, TERMO_MAXIMO_DA_BUSCA),
    p_limite: LIMITE_DA_BUSCA_DE_FORNECEDORES,
  });
  if (error) {
    console.error("[fornecedores.buscar]", error.message);
    return { ok: false, message: "Não foi possível buscar os fornecedores." };
  }
  return { ok: true, fornecedores: (data ?? []) as FornecedorDaBusca[] };
}
