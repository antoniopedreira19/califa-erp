/**
 * Opções do campo **Serviço** do orçamento.
 *
 * Serviço e Categoria leem a MESMA tabela (`categorias_dominio`) e mesmo
 * assim são listas diferentes — quem separa é a coluna `escopo`:
 *
 * - `projeto`   → Serviço    (Always On, Ativação, Fee, Interno)
 * - `orcamento` → Categoria  (Ativação, Conteúdo, Extra, Influencer)
 *
 * O escopo se chama `projeto` porque o campo NASCEU no formulário de
 * projeto. Ele desceu para o orçamento em 02/09/2026 (decisão 037), e o
 * nome do escopo ficou como estava: renomear um valor de enum em uso
 * mexeria nas linhas já gravadas sem devolver nada em troca.
 *
 * Existe como helper porque cinco telas montam o mesmo formulário de
 * orçamento, e repetir a query em cada uma é como as cinco começam a
 * divergir no filtro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategoriaDominio } from "@/lib/types";

export type ServicoOption = Pick<CategoriaDominio, "id" | "nome">;

/** Devolve a PROMISE, não o resultado: quem chama põe dentro do
 *  `Promise.all` que já tem, em vez de somar um await em série
 *  (`docs/PERFORMANCE.md`). */
export function servicosDoOrcamentoQuery(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
) {
  return supabase
    .from("categorias_dominio")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .eq("escopo", "projeto")
    .eq("ativo", true)
    .order("nome");
}
