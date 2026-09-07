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

/**
 * O SERVIÇO de cada orçamento do tenant, pelo id do orçamento.
 *
 * Existe para a lista do financeiro poder mostrar a coluna Serviço — que
 * mora no orçamento, não no job — sem embed aninhado.
 *
 * São DUAS leituras rasas em vez de um
 * `orcamentos(servico:categorias_dominio!servico_id(nome))` dentro do
 * SELECT dos jobs, por um motivo concreto: `orcamentos` tem duas FKs para
 * `categorias_dominio` (`categoria_id` e `servico_id`), e embed ambíguo
 * no PostgREST não devolve a coluna vazia — derruba a query INTEIRA. A
 * lista de jobs do financeiro voltaria vazia, em silêncio, e junto com
 * ela a aba "Visualizar Jobs", que não tem nada a ver com esta coluna.
 *
 * O custo é baixo e não soma latência: são 49 orçamentos e 4 serviços
 * cadastrados hoje, e as duas leituras entram no mesmo `Promise.all` que
 * já busca os jobs (`docs/PERFORMANCE.md`).
 */
export async function servicoPorOrcamento(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
): Promise<Map<string, string>> {
  const [orcRes, servRes] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, servico_id")
      .eq("tenant_id", tenantId)
      .not("servico_id", "is", null),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("escopo", "projeto"),
  ]);

  if (orcRes.error || servRes.error) {
    console.error(
      "[servico-por-orcamento]",
      orcRes.error?.message ?? servRes.error?.message,
    );
    // Devolver o mapa vazio degrada só a coluna Serviço — a lista inteira
    // continua de pé.
    return new Map();
  }

  const nomes = new Map<string, string>();
  for (const s of (servRes.data ?? []) as { id: string; nome: string }[]) {
    nomes.set(s.id, s.nome);
  }

  const mapa = new Map<string, string>();
  for (const o of (orcRes.data ?? []) as {
    id: string;
    servico_id: string | null;
  }[]) {
    const nome = o.servico_id ? nomes.get(o.servico_id) : undefined;
    if (nome) mapa.set(o.id, nome);
  }
  return mapa;
}
