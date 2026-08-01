import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera o proximo codigo PP-NNNNN sequencial por tenant.
 * Chama a funcao Postgres gerar_codigo_pp que usa advisory lock pra
 * serializar geracoes concorrentes sem penalizar leitura.
 */
export async function gerarCodigoPP(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("gerar_codigo_pp", {
    p_tenant_id: tenantId,
  });
  if (error) throw new Error(`Falha ao gerar codigo PP: ${error.message}`);
  return data as string;
}
