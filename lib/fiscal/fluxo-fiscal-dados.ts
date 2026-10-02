/**
 * As leituras das saídas de imposto do Fluxo de caixa (módulo fiscal,
 * entrega 2 — 02/10/2026). A conta mora em `fluxo-fiscal.ts`; aqui só o
 * que se lê do banco, com as consultas independentes em paralelo.
 *
 * Por que no TypeScript e não na `vw_fluxo_caixa`: a guia da Apuração é
 * calculada pelo motor (`lib/fiscal/apuracao.ts`), que não existe no
 * banco. O título e o cronograma vêm junto, do mesmo lugar, para as três
 * etapas do imposto não se separarem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { notasEmitidasDosJobs } from "@/lib/data/faturamento-por-job";
import { calcularApuracao, estadoDaGuia } from "./apuracao";
import { carregarFatosFiscais } from "./apuracao-fatos";
import {
  descricaoDoImposto,
  ppsComIssNaGuia,
  saidasDaApuracao,
  saidasDoCronogramaDeImpostos,
  saidasDosImpostosAPagar,
  type GuiaComEstado,
  type ImpostoEmAberto,
  type JobDoCronograma,
  type SaidaFiscalDoFluxo,
} from "./fluxo-fiscal";

/** Os status em que a previsão de recebimento do job ainda vale na view — os mesmos para o imposto dela. */
const STATUS_COM_PREVISAO = ["aberto", "em_producao", "encerrado", "finalizado"];

interface LinhaDoCronogramaDoBanco {
  id: string;
  job_id: string;
  ordem: number;
  data_prevista: string;
  valor: number | string;
  job: {
    codigo: string;
    empresa_id: string | null;
    regional_id: string | null;
    status: string;
    faturamento_previsto: number | string | null;
  } | null;
}

/**
 * O cronograma de recolhimento de impostos da abertura (decisão 100) dos
 * jobs, com o faturado de cada um. Sem `jobIds`, o tenant inteiro.
 *
 * O faturado é a parte do job nas notas emitidas (`notasEmitidasDosJobs`,
 * a leitura que a esteira, os prazos e a abertura dividem).
 */
export async function carregarCronogramaDeImpostos(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds?: string[],
): Promise<JobDoCronograma[]> {
  if (jobIds && jobIds.length === 0) return [];
  let q = supabase
    .from("jobs_previsao_impostos")
    .select("id, job_id, ordem, data_prevista, valor, job:jobs(codigo, empresa_id, regional_id, status, faturamento_previsto)")
    .eq("tenant_id", tenantId);
  if (jobIds) q = q.in("job_id", jobIds);
  const { data, error } = await q;
  if (error) {
    console.error("[fluxo-fiscal.cronograma]", error.message);
    return [];
  }
  const linhas = ((data ?? []) as unknown as LinhaDoCronogramaDoBanco[]).filter(
    (l) => l.job && STATUS_COM_PREVISAO.includes(l.job.status),
  );
  if (linhas.length === 0) return [];

  const ids = [...new Set(linhas.map((l) => l.job_id))];
  const notasPorJob = await notasEmitidasDosJobs(tenantId, ids);

  const porJob = new Map<string, JobDoCronograma>();
  for (const l of linhas) {
    let j = porJob.get(l.job_id);
    if (!j) {
      const faturado = (notasPorJob.get(l.job_id) ?? []).reduce((s, n) => s + Number(n.parte_do_job ?? 0), 0);
      j = {
        id: l.job_id,
        codigo: l.job!.codigo,
        empresa_id: l.job!.empresa_id,
        regional_id: l.job!.regional_id,
        faturamento_previsto: Number(l.job!.faturamento_previsto ?? 0),
        faturado: Math.round(faturado * 100) / 100,
        linhas: [],
      };
      porJob.set(l.job_id, j);
    }
    j.linhas.push({ id: l.id, ordem: Number(l.ordem), data_prevista: l.data_prevista, valor: Number(l.valor) });
  }
  return [...porJob.values()];
}

export interface FiscalDoFluxo {
  /** Os itens novos: imposto a pagar, guia da Apuração e cronograma da abertura. */
  saidas: SaidaFiscalDoFluxo[];
  /** Parcela de PP em aberto → alíquota do ISS retido que já está numa guia. */
  issRetidoPorParcela: Map<string, number>;
  /** Lançamento da baixa do imposto → o imposto e o nome dele (a tela junta as partes numa linha). */
  baixaDoLancamento: Map<string, { impostoId: string; descricao: string }>;
}

/**
 * Tudo o que o módulo fiscal acrescenta ao Fluxo de caixa geral. Falha de
 * leitura vira "sem o fiscal" (com log), e não página quebrada.
 */
export async function carregarFiscalDoFluxo(
  supabase: SupabaseClient,
  tenantId: string,
  hoje: string,
  janela: { inicio: string; fim: string },
): Promise<FiscalDoFluxo> {
  const [fatos, impostosRes, cronograma, baixasRes] = await Promise.all([
    carregarFatosFiscais(supabase, tenantId).catch((e: unknown) => {
      console.error("[fluxo-fiscal.fatos]", e instanceof Error ? e.message : e);
      return null;
    }),
    supabase
      .from("impostos_a_pagar")
      .select(
        "id, tributo, codigo_receita, descricao, vencimento, valor, rateio:impostos_a_pagar_rateio(empresa_id, regional_id, valor, ordem)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "a_pagar"),
    carregarCronogramaDeImpostos(supabase, tenantId),
    supabase
      .from("lancamentos_financeiros")
      .select("id, imposto_a_pagar_id, imposto:impostos_a_pagar(tributo, codigo_receita, descricao)")
      .eq("tenant_id", tenantId)
      .eq("origem", "imposto_baixa")
      .gte("data_movimento", janela.inicio)
      .lte("data_movimento", janela.fim),
  ]);
  if (impostosRes.error) console.error("[fluxo-fiscal.impostos]", impostosRes.error.message);
  if (baixasRes.error) console.error("[fluxo-fiscal.baixas]", baixasRes.error.message);

  const impostos: ImpostoEmAberto[] = ((impostosRes.data ?? []) as unknown as Array<
    Omit<ImpostoEmAberto, "valor" | "rateio"> & {
      valor: number | string;
      rateio: Array<{ empresa_id: string; regional_id: string | null; valor: number | string; ordem: number }> | null;
    }
  >).map((t) => ({
    ...t,
    valor: Number(t.valor),
    rateio: (t.rateio ?? []).map((r) => ({ ...r, valor: Number(r.valor) })),
  }));

  let guias: GuiaComEstado[] = [];
  let issRetidoPorParcela = new Map<string, number>();
  if (fatos) {
    try {
      guias = calcularApuracao(fatos.cadastro, fatos.fatos, hoje, fatos.aprovacoes).map((g) => {
        const { estado, delta } = estadoDaGuia(g, hoje, fatos.aprovacoes);
        return { ...g, estado, delta };
      });
    } catch (e) {
      // O fluxo segue sem a Apuração (e sem tirar o ISS retido das PPs, que
      // só sai quando a guia de ISS retido está no fluxo).
      console.error("[fluxo-fiscal.apuracao]", e instanceof Error ? e.message : e);
      guias = [];
    }
    const pps = ppsComIssNaGuia(guias, fatos.fatos.notasFornecedor);
    if (pps.size > 0) {
      const { data, error } = await supabase
        .from("pedidos_compra_parcelas")
        .select("id, pedido_compra_id")
        .in("pedido_compra_id", [...pps.keys()])
        .is("pago_em", null);
      if (error) console.error("[fluxo-fiscal.parcelas]", error.message);
      issRetidoPorParcela = new Map(
        ((data ?? []) as Array<{ id: string; pedido_compra_id: string }>).map((p) => [p.id, pps.get(p.pedido_compra_id) ?? 0]),
      );
    }
  }

  const baixaDoLancamento = new Map<string, { impostoId: string; descricao: string }>();
  for (const l of (baixasRes.data ?? []) as unknown as Array<{
    id: string;
    imposto_a_pagar_id: string | null;
    imposto: { tributo: string; codigo_receita: string | null; descricao: string } | null;
  }>) {
    if (!l.imposto_a_pagar_id || !l.imposto) continue;
    baixaDoLancamento.set(l.id, { impostoId: l.imposto_a_pagar_id, descricao: descricaoDoImposto(l.imposto) });
  }

  const dentro = (s: SaidaFiscalDoFluxo) => s.data_evento >= janela.inicio && s.data_evento <= janela.fim;
  return {
    saidas: [
      ...saidasDosImpostosAPagar(impostos),
      ...saidasDaApuracao(guias, hoje),
      ...saidasDoCronogramaDeImpostos(cronograma, hoje),
    ].filter(dentro),
    issRetidoPorParcela,
    baixaDoLancamento,
  };
}
