import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código sequencial `JOB-NNNN` (4 dígitos zero-padded)
 * baseado na contagem atual de jobs do tenant + 1.
 * Sujeito a race condition — unique index (tenant_id, codigo) captura colisões.
 */
export async function gerarCodigoJob(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Falha ao contar jobs: ${error.message}`);
  }

  const seq = ((count ?? 0) + 1).toString().padStart(4, "0");
  return `JOB-${seq}`;
}
