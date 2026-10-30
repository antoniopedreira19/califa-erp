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
 * nunca negativo —, escrita aqui para a tela do job ler o saldo de um job
 * só, sem varrer a fila inteira (31/08/2026).
 *
 * ⚠️ Desde 16/09/2026 (decisão 087) o saldo NÃO trava mais o encerramento:
 * a fila enxerga o job encerrado, e o fechamento mostra o saldo como aviso.
 *
 * Módulo próprio, e não uma cópia dentro da action: a tela do job e o
 * servidor leem o mesmo número. Duas contas divergiriam na
 * primeira nota parcial — foi o que aconteceu com a classificação da
 * esteira antes de virar `lib/data/faturamento-por-job.ts`.
 *
 * Decisão 229: no job internacional, a variação cambial do câmbio fechado
 * soma no saldo da primeira parcela da nota, como na view — a nota sai pelo
 * convertido e o envio fecha.
 */
export async function saldoAFaturarDoJob(
  tenantId: string,
  jobId: string,
): Promise<number> {
  const supabase = createClient();

  const [parcelasRes, itensRes, variacoes] = await Promise.all([
    supabase
      .from("jobs_envio_faturamento_parcelas")
      .select("id, valor, nota_id, ordem")
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
    variacoesCambiaisDoJob(supabase, tenantId, jobId),
  ]);

  if (parcelasRes.error) {
    console.error("[saldo-a-faturar.parcelas]", parcelasRes.error.message);
    return 0;
  }
  if (itensRes.error) {
    console.error("[saldo-a-faturar.itens]", itensRes.error.message);
    return 0;
  }

  const parcelas = (parcelasRes.data ?? []) as {
    id: string;
    valor: number | string;
    nota_id: string;
    ordem: number;
  }[];
  if (parcelas.length === 0) return 0;

  // A variação vai para a primeira parcela de cada nota (decisão 229).
  const primeiraDaNota = new Map<string, string>();
  for (const p of [...parcelas].sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id))) {
    if (!primeiraDaNota.has(p.nota_id)) primeiraDaNota.set(p.nota_id, p.id);
  }

  const faturadoPorParcela = new Map<string, number>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const chave = it.envio_parcela_id as string;
    faturadoPorParcela.set(
      chave,
      (faturadoPorParcela.get(chave) ?? 0) + Number(it.valor ?? 0),
    );
  }

  const total = parcelas.reduce((soma, p) => {
    const variacao = primeiraDaNota.get(p.nota_id) === p.id ? (variacoes.get(p.nota_id) ?? 0) : 0;
    const falta = Number(p.valor ?? 0) + variacao - (faturadoPorParcela.get(p.id) ?? 0);
    return soma + Math.max(0, falta);
  }, 0);

  // Centavo é ruído de arredondamento da divisão em partes iguais, não
  // saldo. Sem este piso, um job com parcelas de 1/3 travaria para sempre.
  return total <= 0.01 ? 0 : Math.round(total * 100) / 100;
}

/**
 * Decisão 229: a variação cambial dos recebimentos antes da NF vivos do job
 * (aguardando a nota ou já aplicados nela), por nota do envio. Vazio fora do
 * internacional.
 */
export async function variacoesCambiaisDoJob(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  jobId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("recebimentos_antes_nf")
    .select("envio_nota_id, variacao_cambial")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .in("status", ["aguardando", "aplicado"])
    .not("variacao_cambial", "is", null)
    .not("envio_nota_id", "is", null);
  const porNota = new Map<string, number>();
  if (error) {
    console.error("[saldo-a-faturar.variacao]", error.message);
    return porNota;
  }
  for (const r of (data ?? []) as Array<{ envio_nota_id: string; variacao_cambial: number | string }>) {
    porNota.set(r.envio_nota_id, (porNota.get(r.envio_nota_id) ?? 0) + Number(r.variacao_cambial ?? 0));
  }
  return porNota;
}
