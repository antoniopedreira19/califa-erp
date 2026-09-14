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

/** `true` quando o job já teve o envio ÚNICO para faturamento. Nos jobs
 *  do modelo mensal cada mês tem o seu envio, e a porta fecha por mês —
 *  ver `mesesEnviadosDoJob`. */
export async function jobJaEnviadoParaFaturamento(
  supabase: SupabaseClient,
  jobId: string,
  tenantId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("jobs_envio_faturamento")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .is("mes", null);
  return (count ?? 0) > 0;
}

/** Os meses (primeiro dia, `yyyy-mm-dd`) de um job do modelo mensal que
 *  já foram enviados para faturamento — Fee e Always On (decisão 078).
 *  Errata e save travam só nesses meses; os outros seguem editáveis. */
export async function mesesEnviadosDoJob(
  supabase: SupabaseClient,
  jobId: string,
  tenantId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("jobs_envio_faturamento")
    .select("mes")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .not("mes", "is", null);
  if (error) {
    // Sem saber o que foi enviado, trava tudo: é o lado seguro da porta.
    console.error("[envio-faturamento.meses]", error.message);
    throw new Error("Não foi possível conferir os meses enviados para faturamento.");
  }
  return new Set(((data ?? []) as { mes: string }[]).map((e) => e.mes));
}

/** A frase da porta mensal, com os meses que ela fecha ("outubro"). */
export function mensagemMesJaEnviado(nomesDosMeses: string[]): string {
  const lista =
    nomesDosMeses.length <= 1
      ? nomesDosMeses.join("")
      : `${nomesDosMeses.slice(0, -1).join(", ")} e ${nomesDosMeses[nomesDosMeses.length - 1]}`;
  const texto = lista.charAt(0).toUpperCase() + lista.slice(1);
  return nomesDosMeses.length === 1
    ? `${texto} já foi enviado para faturamento e o valor da nota daquele mês está congelado: não há errata nem save nele. Os outros meses seguem editáveis.`
    : `${texto} já foram enviados para faturamento e o valor das notas desses meses está congelado: não há errata nem save neles. Os outros meses seguem editáveis.`;
}

/** A mensagem única das duas portas — errata e save falam igual. */
export const MENSAGEM_JA_ENVIADO =
  "Este job já foi enviado para faturamento e o valor da nota está " +
  "congelado: alterá-lo agora faria a nota sair por um número que não é " +
  "mais o do job. Daqui em diante não há errata nem save. Se algo estiver " +
  "errado, fale com o financeiro antes da emissão da nota.";
