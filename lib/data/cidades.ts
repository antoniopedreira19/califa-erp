import { createClient } from "@/lib/supabase/server";
import type { Cidade } from "@/lib/types";

/** O par que todo select/combobox de cidade consome. */
export type CidadeOpcao = Pick<Cidade, "id" | "nome">;

/**
 * Máximo de cidades devolvidas por consulta.
 *
 * O cadastro foi desenhado para receber a lista completa do IBGE (~5.570
 * municípios) — nunca carregue tudo no cliente. A página traz só as
 * primeiras, para o combobox não abrir vazio, e o resto vem por digitação
 * (`buscarCidades`). Regra da decisão 005.
 */
export const LIMITE_CIDADES = 30;

/**
 * Cidades ativas do tenant em ordem alfabética, no máximo `LIMITE_CIDADES`.
 * Sem termo, são as primeiras; com termo, as que contêm o trecho no nome.
 */
export async function listarCidades(
  tenantId: string,
  termo = "",
): Promise<CidadeOpcao[]> {
  const supabase = createClient();

  let query = supabase
    .from("cidades")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("nome")
    .limit(LIMITE_CIDADES);

  const q = termo.trim();
  if (q.length > 0) {
    // Escapa os curingas do LIKE para que "%" digitado busque literal.
    const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.ilike("nome", `%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[cidades.listar]", error.message);
    return [];
  }
  return (data ?? []) as CidadeOpcao[];
}

/** Primeiras cidades — o que a página manda para o combobox abrir cheio. */
export async function listarCidadesIniciais(
  tenantId: string,
): Promise<CidadeOpcao[]> {
  return listarCidades(tenantId);
}
