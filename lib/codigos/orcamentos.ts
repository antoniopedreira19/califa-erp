import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código do orçamento no formato "[CODIGO_PROJETO]-[SEQ_2]".
 * Sequencial por projeto. Ex.: "AMB-P003/26-01" — até a decisão 114
 * (28/09/2026), "AMB-0003/26-01". O código de antes saiu do sistema em
 * 29/09/2026 (decisão 126).
 */
export async function gerarCodigoOrcamento(
  supabase: SupabaseClient,
  projetoId: string,
  tenantId: string,
): Promise<string> {
  // 1) codigo do projeto
  const { data: projeto, error: errProj } = await supabase
    .from("projetos")
    .select("codigo")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ codigo: string }>();

  if (errProj || !projeto?.codigo) {
    throw new Error("Projeto não encontrado.");
  }

  // 2) Os códigos que o projeto já usou
  const { data: orcamentos, error: errCodigos } = await supabase
    .from("orcamentos")
    .select("codigo")
    .eq("projeto_id", projetoId)
    .eq("tenant_id", tenantId);

  if (errCodigos) {
    throw new Error(`Falha ao ler os orçamentos do projeto: ${errCodigos.message}`);
  }

  const seq = proximaSequenciaOrcamento(
    projeto.codigo,
    ((orcamentos ?? []) as { codigo: string }[]).map((o) => o.codigo),
  );
  return `${projeto.codigo}-${String(seq).padStart(2, "0")}`;
}

/**
 * O próximo número da sequência do projeto: um acima do MAIOR já usado.
 *
 * Até 06/10/2026 era a contagem + 1. Com orçamento apagado no meio da
 * sequência — as 36 cópias da AMB-P017/26 —, a contagem fica abaixo do
 * maior número, o próximo código nasce igual a um que ainda existe e o
 * índice único recusa o "Salvar" toda vez. A contagem fica como piso para
 * código fora do padrão `[CODIGO_PROJETO]-NN` (não há nenhum hoje).
 */
export function proximaSequenciaOrcamento(
  codigoProjeto: string,
  codigos: string[],
): number {
  const prefixo = `${codigoProjeto}-`;
  let maior = 0;
  for (const codigo of codigos) {
    if (!codigo.startsWith(prefixo)) continue;
    const sufixo = codigo.slice(prefixo.length);
    if (!/^\d+$/.test(sufixo)) continue;
    maior = Math.max(maior, Number(sufixo));
  }
  return Math.max(maior, codigos.length) + 1;
}
