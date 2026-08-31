import { createClient } from "@/lib/supabase/server";

/**
 * Quanto ainda falta faturar de um job — em reais, pela mesma régua da
 * fila de faturamento.
 *
 * O envio para faturamento diz em quantas notas o job será faturado
 * (`jobs_envio_faturamento_parcelas`). Cada parcela vira uma linha da aba
 * Faturamento e sai da fila quando uma nota EMITIDA a cobre. Enquanto
 * sobrar parcela sem nota, há dinheiro a receber que ainda não virou
 * título.
 *
 * A conta é a mesma da `vw_faturamento_pendente` — `valor - já faturado`,
 * nunca negativo —, escrita aqui porque a view filtra `status = 'aberto'`
 * e o encerramento precisa justamente saber o saldo de um job que está
 * prestes a deixar de ser aberto (31/08/2026).
 *
 * Módulo próprio, e não uma cópia dentro da action: quem mostra a trava é
 * a tela do job e quem a aplica é o servidor. Duas contas divergiriam na
 * primeira nota parcial — foi o que aconteceu com a classificação da
 * esteira antes de virar `lib/data/faturamento-por-job.ts`.
 */
export async function saldoAFaturarDoJob(
  tenantId: string,
  jobId: string,
): Promise<number> {
  const supabase = createClient();

  const [parcelasRes, itensRes] = await Promise.all([
    supabase
      .from("jobs_envio_faturamento_parcelas")
      .select("id, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    // Só nota EMITIDA abate. Cancelada devolve a parcela para a fila, e é
    // por isso que o filtro de status vive no embed `!inner` em vez de
    // numa segunda leitura.
    supabase
      .from("faturamento_itens")
      .select("envio_parcela_id, valor, faturamento:faturamentos!inner(status)")
      .eq("tenant_id", tenantId)
      .eq("faturamento.status", "emitido")
      .not("envio_parcela_id", "is", null),
  ]);

  if (parcelasRes.error) {
    console.error("[saldo-a-faturar.parcelas]", parcelasRes.error.message);
    return 0;
  }
  if (itensRes.error) {
    console.error("[saldo-a-faturar.itens]", itensRes.error.message);
    return 0;
  }

  const parcelas = (parcelasRes.data ?? []) as { id: string; valor: number | string }[];
  if (parcelas.length === 0) return 0;

  const faturadoPorParcela = new Map<string, number>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const chave = it.envio_parcela_id as string;
    faturadoPorParcela.set(
      chave,
      (faturadoPorParcela.get(chave) ?? 0) + Number(it.valor ?? 0),
    );
  }

  const total = parcelas.reduce((soma, p) => {
    const falta = Number(p.valor ?? 0) - (faturadoPorParcela.get(p.id) ?? 0);
    return soma + Math.max(0, falta);
  }, 0);

  // Centavo é ruído de arredondamento da divisão em partes iguais, não
  // saldo. Sem este piso, um job com parcelas de 1/3 travaria para sempre.
  return total <= 0.01 ? 0 : Math.round(total * 100) / 100;
}
