/** A porta que o envio para faturamento fecha.
 *
 *  Quando um job é enviado para faturamento, `jobs_envio_faturamento`
 *  guarda uma CÓPIA CONGELADA do valor e as parcelas são definidas contra
 *  ela. Mexer no orçado depois disso — por errata ou por save — muda
 *  `jobs.faturamento_previsto` e deixa os dois números divergentes: a nota
 *  sairia pelo valor antigo.
 *
 *  A decisão 008 §3 montou uma rede para essa divergência (o resumo de
 *  fechamento mostra os dois números e pede confirmação ao financeiro).
 *  Desde 27/08/2026, por decisão do Tiago, a divergência deixa de ser
 *  criada: depois do envio, nem errata nem save. A rede da 008 §3 fica
 *  para os jobs que já a tinham gravada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** `true` quando o job já foi enviado para faturamento. */
export async function jobJaEnviadoParaFaturamento(
  supabase: SupabaseClient,
  jobId: string,
  tenantId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("jobs_envio_faturamento")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId);
  return (count ?? 0) > 0;
}

/** A mensagem única das duas portas — errata e save falam igual. */
export const MENSAGEM_JA_ENVIADO =
  "Este job já foi enviado para faturamento. O valor da nota está congelado, " +
  "e alterá-lo agora faria a nota sair por um número que não é mais o do job. " +
  "Para corrigir, peça ao financeiro para desfazer o envio.";
