import type { SessionContext } from "@/lib/types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createClient>;

/**
 * UUIDs dos projetos onde o usuario esta envolvido, por qualquer via:
 *
 *   1. projeto_responsaveis (papel 'gp' OU 'equipe')
 *   2. projetos.created_by = eu
 *   3. orcamentos.gp_responsavel_id = eu (algum orcamento do projeto)
 *   4. orcamentos.produtor_id = eu (algum orcamento do projeto)
 *
 * Ha uma unica ida ao banco por query (nao 4). O UNION acontece no
 * cliente porque as 4 fontes estao em tabelas diferentes e um `UNION`
 * SQL exigiria RPC — o custo de rede de 4 counts pequenos e menor.
 *
 * O array pode estar vazio (usuario sem projeto nenhum). Consumidores
 * devem tratar esse caso — passar array vazio pra `.in("projeto_id", [])`
 * do PostgREST devolve zero rows, que e exatamente o que queremos.
 */
export async function projetoIdsDoUsuario(
  session: SessionContext,
  supabase: Supabase,
): Promise<string[]> {
  const tenantId = session.activeTenant.id;
  const userId = session.profile.id;
  const ids = new Set<string>();

  const [respRes, criadosRes, orcsRes] = await Promise.all([
    supabase
      .from("projeto_responsaveis")
      .select("projeto_id")
      .eq("tenant_id", tenantId)
      .eq("profile_id", userId),
    supabase
      .from("projetos")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("created_by", userId),
    supabase
      .from("orcamentos")
      .select("projeto_id")
      .eq("tenant_id", tenantId)
      .or(`gp_responsavel_id.eq.${userId},produtor_id.eq.${userId}`),
  ]);

  for (const r of respRes.data ?? []) if (r.projeto_id) ids.add(r.projeto_id);
  for (const r of criadosRes.data ?? []) if (r.id) ids.add(r.id);
  for (const r of orcsRes.data ?? []) if (r.projeto_id) ids.add(r.projeto_id);

  return Array.from(ids);
}
