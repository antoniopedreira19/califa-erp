/**
 * Os jobs de um ano do histórico, com as notas de cada um (decisão 211, A4):
 * a função `historico_faturamento_jobs` lê os jobs da aba Res. Jobs do ano
 * nas cargas ativas e soma as notas emitidas de cada um, o faturado e o
 * recebido. A situação e o a receber ficam em
 * `lib/historico-financeiro/faturamento.ts`.
 */
import type { createClient } from "@/lib/supabase/server";
import type { JobFaturadoDoHistorico, NotaDoHistorico } from "@/lib/historico-financeiro/faturamento";

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
    emissores: Record<string, { notas: Numero; faturado: Numero; recebido: Numero }>;
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
      emissores: Object.fromEntries(
        Object.entries(j.emissores ?? {}).map(([e, s]) => [e, { notas: Number(s.notas), faturado: Number(s.faturado), recebido: Number(s.recebido) }]),
      ),
    })),
  };
}

export interface NotasEmitidasNoAno {
  cobertura: NotasDoAno["cobertura"];
  notas: NotaDoHistorico[];
}

/**
 * As notas emitidas no ano, pela data de emissão, de todos os emissores: a
 * visão por CNPJ, como as abas de Faturamento. `null` quando a leitura falha.
 */
export async function carregarNotasEmitidas(supabase: Supabase, tenantId: string, ano: number): Promise<NotasEmitidasNoAno | null> {
  const { data, error } = await supabase.rpc("historico_faturamento_notas", { p_tenant_id: tenantId, p_ano: ano });
  if (error) {
    console.error("[relatorios.faturamento-historico.notas]", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as { cobertura: NotasDoAno["cobertura"]; notas?: (Omit<NotaDoHistorico, "valor" | "impostos" | "linha"> & { linha: Numero; valor: Numero; impostos: Numero })[] };
  return {
    cobertura: r.cobertura,
    notas: (r.notas ?? []).map((n) => ({
      estabelecimento: n.estabelecimento,
      aba: n.aba,
      linha: Number(n.linha),
      numero: n.numero,
      classe: n.classe,
      empresa: n.empresa,
      job: n.job,
      cliente: n.cliente,
      emissao: n.emissao,
      vencimento: n.vencimento,
      recebimento: n.recebimento,
      valor: Number(n.valor),
      impostos: Number(n.impostos),
    })),
  };
}
