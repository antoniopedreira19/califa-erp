/**
 * Os jobs de um ano do histórico, com as somas de cada um (decisão 211, A4):
 * a função `historico_rentabilidade_jobs` lê os jobs da aba Res. Jobs do ano
 * nas cargas ativas e soma a receita, o custo e o imposto das notas de cada
 * um. A conta do resultado e da rentabilidade fica em
 * `lib/historico-financeiro/rentabilidade.ts`.
 */
import type { createClient } from "@/lib/supabase/server";
import type { JobDoHistorico } from "@/lib/historico-financeiro/rentabilidade";

type Supabase = ReturnType<typeof createClient>;

export interface JobsDoAno {
  /** O período que as cargas ativas cobrem; nulo quando não há carga. */
  cobertura: { de: string; ate: string } | null;
  jobs: JobDoHistorico[];
}

type Numero = number | string;
type Resposta = {
  cobertura: { de: string; ate: string } | null;
  jobs?: {
    chave: string;
    nome: string;
    empresa: string;
    trimestre: string | null;
    cliente_id: string | null;
    cliente: string | null;
    marca_id: string | null;
    marca: string | null;
    fee_percentual: Numero | null;
    receita: Numero;
    imposto: Numero;
    custo: Numero;
  }[];
};

/** Os jobs do ano, ou `null` quando a leitura falha. */
export async function carregarJobsDoAno(supabase: Supabase, tenantId: string, ano: number): Promise<JobsDoAno | null> {
  const { data, error } = await supabase.rpc("historico_rentabilidade_jobs", { p_tenant_id: tenantId, p_ano: ano });
  if (error) {
    console.error("[relatorios.rentabilidade-historico]", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as Resposta;
  return {
    cobertura: r.cobertura,
    jobs: (r.jobs ?? []).map((j) => ({
      chave: j.chave,
      nome: j.nome,
      empresa: j.empresa,
      trimestre: j.trimestre,
      clienteId: j.cliente_id,
      cliente: j.cliente,
      marcaId: j.marca_id,
      marca: j.marca,
      feePercentual: j.fee_percentual === null ? null : Number(j.fee_percentual),
      receita: Number(j.receita),
      imposto: Number(j.imposto),
      custo: Number(j.custo),
    })),
  };
}
