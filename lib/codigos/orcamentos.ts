import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código do orçamento no formato "[CODIGO_PROJETO]-[SEQ_2]".
 * Sequencial por projeto. Ex.: "AMB-0003/26-01".
 */
export async function gerarCodigoOrcamento(
  supabase: SupabaseClient,
  projetoId: string,
): Promise<string> {
  // 1) codigo do projeto
  const { data: projeto, error: errProj } = await supabase
    .from("projetos")
    .select("codigo")
    .eq("id", projetoId)
    .maybeSingle<{ codigo: string }>();

  if (errProj || !projeto?.codigo) {
    throw new Error("Projeto não encontrado.");
  }

  // 2) Conta orçamentos do projeto
  const { count, error: errCount } = await supabase
    .from("orcamentos")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", projetoId);

  if (errCount) {
    throw new Error(`Falha ao contar orçamentos: ${errCount.message}`);
  }

  const seq = ((count ?? 0) + 1).toString().padStart(2, "0");
  return `${projeto.codigo}-${seq}`;
}
