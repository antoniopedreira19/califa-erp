import { createClient } from "@/lib/supabase/server";
import type { CategoriaModeloPlanilha } from "@/lib/types";

/**
 * De qual modelo é a planilha deste orçamento — pela CATEGORIA dele
 * (decisão 072).
 *
 * Serve às portas de entrada de versão, que precisam saber com que
 * parâmetros a versão nasce. A tela não usa esta função: lá o
 * `modelo_planilha` já vem no embed da categoria, junto do nome.
 *
 * Falha de leitura devolve `"nacional"` — o fechamento que todo orçamento
 * sempre teve. É o degrau seguro: uma versão que nasce nacional por engano
 * é corrigida no "Editar" da tela; uma que nasce internacional por engano
 * carregaria int. taxes num job que não as tem.
 */
export async function modeloPlanilhaDoOrcamento(
  orcamentoId: string,
  tenantId: string,
): Promise<CategoriaModeloPlanilha> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("orcamentos")
    // `!categoria_id` é obrigatório: `orcamentos` tem duas FKs para
    // `categorias_dominio` (categoria e serviço) desde 02/09/2026, e o
    // embed ambíguo derruba a query inteira em silêncio.
    .select("categoria:categorias_dominio!categoria_id(modelo_planilha)")
    .eq("id", orcamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
    }>();

  if (error) {
    console.error("[modeloPlanilhaDoOrcamento]", error.message);
    return "nacional";
  }
  return data?.categoria?.modelo_planilha ?? "nacional";
}
