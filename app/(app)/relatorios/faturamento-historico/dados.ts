/**
 * Os jobs de um ano do histórico, com as notas de cada um (decisão 211, A4):
 * a função `historico_faturamento_jobs` lê os jobs da aba Res. Jobs do ano
 * nas cargas ativas e soma as notas emitidas de cada um, o faturado e o
 * recebido. A situação e o a receber ficam em
 * `lib/historico-financeiro/faturamento.ts`.
 */
import type { createClient } from "@/lib/supabase/server";
import type { JobFaturadoDoHistorico } from "@/lib/historico-financeiro/faturamento";

type Supabase = ReturnType<typeof createClient>;

export interface NotasDoAno {
  /** O período que as cargas ativas cobrem e a versão da planilha; nulo quando não há carga. */
  cobertura: { de: string; ate: string; versao: string } | null;
  jobs: JobFaturadoDoHistorico[];
}

type Numero = number | string;
type Resposta = {
  cobertura: { de: string; ate: string; versao: string } | null;
  jobs?: {
    chave: string;
    nome: string;
    empresa: string;
    trimestre: string | null;
    cliente_id: string | null;
    cliente: string | null;
    marca_id: string | null;
    marca: string | null;
    notas: Numero;
    faturado: Numero;
    recebido: Numero;
  }[];
};

/** Os jobs do ano com as notas, ou `null` quando a leitura falha. */
export async function carregarNotasDoAno(supabase: Supabase, tenantId: string, ano: number): Promise<NotasDoAno | null> {
  const { data, error } = await supabase.rpc("historico_faturamento_jobs", { p_tenant_id: tenantId, p_ano: ano });
  if (error) {
    console.error("[relatorios.faturamento-historico]", error.message);
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
      notas: Number(j.notas),
      faturado: Number(j.faturado),
      recebido: Number(j.recebido),
    })),
  };
}
