/**
 * O par serviço × categoria de um orçamento, conferido no servidor
 * (decisão 078; aprovação desde a revisão da 149, 07/10/2026).
 *
 * Lê as mesmas listas de `conferirServicoECategoria` (actions do projeto):
 * TODAS as categorias do escopo, inclusive as inativas — a exclusividade de
 * um serviço não some porque alguém desativou a categoria —, e o serviço.
 * A regra é a de sempre, `erroDoParServicoCategoria`, para a tela, a action
 * e o gatilho do banco (`versao_aprova_com_servico_e_categoria_coerentes`)
 * contarem a mesma história.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  erroDoParServicoCategoria,
  type CategoriaParaServico,
} from "@/lib/categorias-do-servico";

/**
 * `erro: null` quando o par combina — ou quando o orçamento não tem serviço
 * ou categoria (dado anterior à obrigatoriedade deles, que a regra nunca
 * cobrou). Senão, a frase do motivo. Falha de leitura volta `ok: false`:
 * na aprovação, não conferir é não aprovar.
 */
export async function erroDoParDoOrcamento(
  supabase: SupabaseClient,
  tenantId: string,
  servicoId: string | null,
  categoriaId: string | null,
): Promise<{ ok: true; erro: string | null } | { ok: false; message: string }> {
  if (!servicoId || !categoriaId) return { ok: true, erro: null };
  const [catRes, servRes] = await Promise.all([
    supabase
      .from("categorias_dominio")
      .select("id, nome, modelo_planilha, servico_exclusivo_id, aceita_servico_interno, em_breve")
      .eq("tenant_id", tenantId)
      .eq("escopo", "orcamento")
      .returns<CategoriaParaServico[]>(),
    supabase
      .from("categorias_dominio")
      .select("id, nome, investimento_interno")
      .eq("id", servicoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; nome: string; investimento_interno: boolean }>(),
  ]);
  if (catRes.error || servRes.error) {
    console.error("[par-servico-categoria]", (catRes.error ?? servRes.error)?.message);
    return {
      ok: false,
      message: "Não foi possível conferir o serviço e a categoria do orçamento. Tente de novo.",
    };
  }
  const categorias = catRes.data ?? [];
  const categoria = categorias.find((c) => c.id === categoriaId);
  if (!categoria || !servRes.data) return { ok: true, erro: null };
  return {
    ok: true,
    erro: erroDoParServicoCategoria(servRes.data, categoria, categorias, servRes.data.nome),
  };
}
