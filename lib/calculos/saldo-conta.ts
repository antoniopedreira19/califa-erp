import type { SupabaseClient } from "@supabase/supabase-js";

export type LancamentoLinha = {
  id: string;
  data_movimento: string;
  descricao: string;
  natureza: "entrada" | "saida";
  valor: number;
  fornecedor_nome: string | null;
  job_codigo: string | null;
  tipo_codigo: string;
  tipo_nome: string;
  subtipo_nome: string;
  origem: string;
  credito: number;
  debito: number;
  saldo: number;
};

/**
 * Retorna o saldo da conta ANTES de `dataDe` (inclusive saldo_inicial da conta).
 * Se dataDe <= saldo_inicial_data, retorna saldo_inicial.
 */
export async function calcularSaldoAnterior(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    contaId: string;
    dataDe: string; // YYYY-MM-DD
  },
): Promise<{ saldoAnterior: number; saldoInicialData: string }> {
  const { data: conta } = await supabase
    .from("contas_bancarias")
    .select("saldo_inicial, saldo_inicial_data")
    .eq("id", args.contaId)
    .eq("tenant_id", args.tenantId)
    .single();

  if (!conta) return { saldoAnterior: 0, saldoInicialData: args.dataDe };

  const saldoInicial = Number(conta.saldo_inicial);
  const saldoInicialData: string = conta.saldo_inicial_data;

  if (args.dataDe <= saldoInicialData) {
    return { saldoAnterior: saldoInicial, saldoInicialData };
  }

  const { data: lancsAnteriores } = await supabase
    .from("lancamentos_financeiros")
    .select("valor, natureza")
    .eq("tenant_id", args.tenantId)
    .eq("conta_bancaria_id", args.contaId)
    .gte("data_movimento", saldoInicialData)
    .lt("data_movimento", args.dataDe);

  const delta = (lancsAnteriores ?? []).reduce((acc, l) => {
    const v = Number(l.valor);
    return acc + (l.natureza === "entrada" ? v : -v);
  }, 0);

  return { saldoAnterior: saldoInicial + delta, saldoInicialData };
}

/**
 * Enriquece as linhas do período com credito/debito/saldo derivado.
 * Recebe raw rows já ordenadas por data_movimento ASC, created_at ASC.
 */
export function derivarSaldo(
  rows: Omit<LancamentoLinha, "credito" | "debito" | "saldo">[],
  saldoAnterior: number,
): LancamentoLinha[] {
  let saldo = saldoAnterior;
  return rows.map((r) => {
    const credito = r.natureza === "entrada" ? r.valor : 0;
    const debito = r.natureza === "saida" ? r.valor : 0;
    saldo = saldo + credito - debito;
    return { ...r, credito, debito, saldo };
  });
}
