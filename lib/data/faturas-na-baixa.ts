/**
 * As faturas de cartão que o campo Fatura da baixa usa (decisão 197): as
 * dos cartões do tenant a partir de seis meses atrás, de todo status — as
 * abertas viram opção, e as fechadas, pagas e canceladas fazem a fatura da
 * data pular para a competência seguinte, como no banco.
 *
 * Poucas linhas por cartão (uma por mês), lidas junto das outras consultas
 * da página.
 */

import type { createClient } from "@/lib/supabase/server";
import type { FaturaDoCartaoNaBaixa, StatusDaFatura } from "@/lib/financeiro/fatura-do-cartao";

type Supabase = ReturnType<typeof createClient>;

/** O dia 1 do mês, seis meses antes de `hoje` (AAAA-MM-DD). */
function seisMesesAntes(hoje: string): string {
  const [a, m] = hoje.split("-").map(Number);
  const t = a * 12 + (m - 1) - 6;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

export async function carregarFaturasNaBaixa(
  supabase: Supabase,
  tenantId: string,
  hoje: string,
): Promise<FaturaDoCartaoNaBaixa[]> {
  const { data, error } = await supabase
    .from("faturas_cartao")
    .select("id, codigo, cartao_credito_id, competencia_fechamento, data_vencimento, status")
    .eq("tenant_id", tenantId)
    .gte("competencia_fechamento", seisMesesAntes(hoje))
    .order("competencia_fechamento", { ascending: true });
  if (error) {
    console.error("[faturas-na-baixa]", error.message);
    return [];
  }
  return (
    (data ?? []) as Array<{
      id: string;
      codigo: string;
      cartao_credito_id: string;
      competencia_fechamento: string;
      data_vencimento: string;
      status: StatusDaFatura;
    }>
  ).map((f) => ({
    id: f.id,
    codigo: f.codigo,
    cartaoId: f.cartao_credito_id,
    competenciaFechamento: f.competencia_fechamento,
    dataVencimento: f.data_vencimento,
    status: f.status,
  }));
}
