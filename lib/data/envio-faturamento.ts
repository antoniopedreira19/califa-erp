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
 *
 *  ⚠️ Desde 22/09/2026 (decisão 099) o SAVE tem porta própria, e as duas
 *  deixaram de falar igual:
 *   - a errata comum segue fechando no envio para faturamento
 *     (`MENSAGEM_JA_ENVIADO`, `mensagemMesJaEnviado`);
 *   - o CONSUMO de save (consumir, editar o consumo, retirar o consumo)
 *     fecha no mesmo envio — no modelo mensal, no mês da linha —, porque
 *     muda o faturamento previsto (`MENSAGEM_CONSUMO_JA_ENVIADO`,
 *     `mensagemConsumoMesJaEnviado`);
 *   - GERAR save (e retirar o save gerado) continua possível até o envio
 *     para encerramento: a linha em save continua no faturamento, só sai do
 *     valor do job.
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
 *  Errata e consumo de save travam só nesses meses; os outros seguem
 *  editáveis. */
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
  // "nem save" saiu em 22/09/2026 (decisão 099): gerar save continua
  // possível depois do envio, e o consumo tem a frase própria abaixo.
  return nomesDosMeses.length === 1
    ? `${texto} já foi enviado para faturamento e o valor da nota daquele mês está congelado: não há errata nele. Os outros meses seguem editáveis.`
    : `${texto} já foram enviados para faturamento e o valor das notas desses meses está congelado: não há errata neles. Os outros meses seguem editáveis.`;
}

/** A porta da ERRATA comum. Desde 22/09/2026 (decisão 099) o save tem a
 *  dele — ver `MENSAGEM_CONSUMO_JA_ENVIADO`. */
export const MENSAGEM_JA_ENVIADO =
  "Este job já foi enviado para faturamento e o valor da nota está " +
  "congelado: alterá-lo agora faria a nota sair por um número que não é " +
  "mais o do job. Daqui em diante não há errata. Se algo estiver " +
  "errado, fale com o financeiro antes da emissão da nota.";

/** A porta do CONSUMO de save no envio único (decisão 099, 22/09/2026):
 *  consumir, editar o consumo e retirá-lo mudam o faturamento previsto, que
 *  a nota já congelou. Gerar save não passa por aqui. */
export const MENSAGEM_CONSUMO_JA_ENVIADO =
  "Este job já foi enviado para faturamento e o valor da nota está " +
  "congelado: daqui em diante nenhuma linha passa a consumir saldo de save, " +
  "muda o consumo ou deixa de consumir. Gerar save continua possível até o " +
  "envio para encerramento.";

/** A porta do CONSUMO de save no modelo mensal: fecha só no mês já
 *  enviado (decisão 099, 22/09/2026). */
export function mensagemConsumoMesJaEnviado(nomesDosMeses: string[]): string {
  const lista =
    nomesDosMeses.length <= 1
      ? nomesDosMeses.join("")
      : `${nomesDosMeses.slice(0, -1).join(", ")} e ${nomesDosMeses[nomesDosMeses.length - 1]}`;
  const texto = lista.charAt(0).toUpperCase() + lista.slice(1);
  return nomesDosMeses.length === 1
    ? `${texto} já foi enviado para faturamento e o valor da nota daquele mês está congelado: nenhuma linha dele passa a consumir saldo de save, muda o consumo ou deixa de consumir. Gerar save continua possível em qualquer mês até o envio para encerramento.`
    : `${texto} já foram enviados para faturamento e o valor das notas desses meses está congelado: nenhuma linha deles passa a consumir saldo de save, muda o consumo ou deixa de consumir. Gerar save continua possível em qualquer mês até o envio para encerramento.`;
}
