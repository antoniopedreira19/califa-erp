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
 *
 *  ⚠️ Esta porta NÃO tem volta, e é assim de propósito. Não existe
 *  "desfazer o envio": `jobs_envio_faturamento` é única por job e nenhuma
 *  tela a apaga. A regra que sustenta isso é do Tiago (31/08/2026): a
 *  negociação com o cliente já terminou quando o job é enviado para
 *  faturamento, então errata depois do envio realmente não deve existir.
 *  A mensagem abaixo chegou a mandar o usuário pedir o desfazimento ao
 *  financeiro — mandava atrás de algo que ninguém pode fazer.
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
  "Este job já foi enviado para faturamento e o valor da nota está " +
  "congelado: alterá-lo agora faria a nota sair por um número que não é " +
  "mais o do job. Daqui em diante não há errata nem save. Se algo estiver " +
  "errado, fale com o financeiro antes da emissão da nota.";
