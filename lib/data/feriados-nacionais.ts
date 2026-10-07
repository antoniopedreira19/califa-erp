import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Os feriados NACIONAIS do cadastro de feriados do Fiscal (`fiscal_feriados`
 * com `municipio` nulo), em ISO. É o que a data-limite de envio da PP
 * considera dia não útil além do fim de semana (decisão 157): os municipais
 * do cadastro (Salvador, São Paulo, Santo André, Fortaleza) ficam de fora,
 * por escolha do Tiago em 07/10/2026.
 *
 * Qualquer membro do tenant lê a tabela (`fiscal_feriados_select`), então
 * o GP e o produtor enxergam a mesma lista que o financeiro mantém. Falha
 * na leitura devolve lista vazia: a regra cai para "só fim de semana", que
 * é o que vale até o fim de 2027 de qualquer jeito — nenhuma data-limite
 * desse período cai em feriado cadastrado.
 */
export async function carregarFeriadosNacionais(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("fiscal_feriados")
    .select("data")
    .eq("tenant_id", tenantId)
    .is("municipio", null)
    .returns<Array<{ data: string }>>();
  if (error) {
    console.error("[feriados.nacionais]", error.message);
    return [];
  }
  return (data ?? []).map((f) => f.data.slice(0, 10));
}
