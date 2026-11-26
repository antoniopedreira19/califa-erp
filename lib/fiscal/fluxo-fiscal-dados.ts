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
import { blocosAApurar, type TituloAApurar } from "./a-apurar";
import { carregarTitulosAApurar } from "./a-apurar-dados";
import { calcularApuracao, estadoDaGuia } from "./apuracao";
import { carregarFatosFiscais } from "./apuracao-fatos";
import {
  TRIBUTOS_SO_APROVADOS_NO_FLUXO,
  chavesDoFiscalNoFluxo,
  descricaoDoImposto,
  ppsComIssNaGuia,
  previsoesDaPlanilhaQueSaem,
  saidasAApurar,
  saidasDaApuracao,
  saidasDoCronogramaDeImpostos,
  saidasDosImpostosAPagar,
  tributoDaLinhaDaPlanilha,
  type GuiaComEstado,
  type ImpostoEmAberto,
  type JobDoCronograma,
  type PrevisaoDeImpostoDaPlanilha,
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

/**
 * As previsões de imposto da planilha ainda sem extrato (carga de previsão
 * ativa), com o CNPJ da conta que paga — as candidatas a sair do fluxo pela
 * regra da decisão 277 §8. Só o centro tributário (03 e 15).
 */
async function carregarPrevisoesDeImpostoDaPlanilha(
  supabase: SupabaseClient,
  tenantId: string,
  fim: string,
): Promise<PrevisaoDeImpostoDaPlanilha[]> {
  const out: PrevisaoDeImpostoDaPlanilha[] = [];
  const PAGINA = 1000;
  for (let de = 0; de < 20_000; de += PAGINA) {
    const { data, error } = await supabase
      .from("historico_movimentos")
      .select("id, data, descricao, plano_codigo, conta:contas_bancarias(empresa_contabil_id), carga:historico_cargas!inner(tipo, situacao)")
      .eq("tenant_id", tenantId)
      .eq("carga.tipo", "previsao")
      .eq("carga.situacao", "ativa")
      .is("extrato_linha_id", null)
      .neq("valor", 0)
      .lte("data", fim)
      .or("plano_codigo.like.03.*,plano_codigo.like.15.*")
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) {
      console.error("[fluxo-fiscal.previsoes-da-planilha]", error.message);
      return out;
    }
    const linhas = (data ?? []) as unknown as Array<{
      id: string;
      data: string;
      descricao: string | null;
      plano_codigo: string | null;
      conta: { empresa_contabil_id: string | null } | null;
    }>;
    for (const l of linhas) {
      const tributo = tributoDaLinhaDaPlanilha(l);
      if (tributo) out.push({ id: l.id, pj: l.conta?.empresa_contabil_id ?? null, tributo, data: l.data });
    }
    if (linhas.length < PAGINA) break;
  }
  return out;
}

export interface FiscalDoFluxo {
  /** Os itens novos: imposto a pagar, guia da Apuração, "a apurar no recebimento" e cronograma da abertura. */
  saidas: SaidaFiscalDoFluxo[];
  /** Parcela de PP em aberto → alíquota do ISS retido que já está numa guia. */
  issRetidoPorParcela: Map<string, number>;
  /** Lançamento da baixa do imposto → o imposto e o nome dele (a tela junta as partes numa linha). */
  baixaDoLancamento: Map<string, { impostoId: string; descricao: string }>;
  /**
   * Decisão 277 §8: as previsões de imposto da planilha (`previsao_planilha`,
   * pelo id da linha do histórico) que saem do fluxo porque o Fiscal já tem
   * aquele imposto — cada real numa fonte só.
   */
  previsoesDaPlanilhaQueSaem: Set<string>;
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
  const [fatos, impostosRes, cronograma, baixasRes, previsoesDaPlanilha] = await Promise.all([
    carregarFatosFiscais(supabase, tenantId).catch((e: unknown) => {
      console.error("[fluxo-fiscal.fatos]", e instanceof Error ? e.message : e);
      return null;
    }),
    supabase
      .from("impostos_a_pagar")
      .select(
        "id, tributo, codigo_receita, descricao, vencimento, valor, empresa_contabil_id, competencia, rateio:impostos_a_pagar_rateio(empresa_id, regional_id, valor, ordem)",
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
    carregarPrevisoesDeImpostoDaPlanilha(supabase, tenantId, janela.fim).catch((e: unknown) => {
      console.error("[fluxo-fiscal.previsoes-da-planilha]", e instanceof Error ? e.message : e);
      return [] as PrevisaoDeImpostoDaPlanilha[];
    }),
  ]);
  if (impostosRes.error) console.error("[fluxo-fiscal.impostos]", impostosRes.error.message);
  if (baixasRes.error) console.error("[fluxo-fiscal.baixas]", baixasRes.error.message);

  const impostosDoBanco = (impostosRes.data ?? []) as unknown as Array<
    Omit<ImpostoEmAberto, "valor" | "rateio"> & {
      valor: number | string;
      empresa_contabil_id: string;
      competencia: string;
      rateio: Array<{ empresa_id: string; regional_id: string | null; valor: number | string; ordem: number }> | null;
    }
  >;
  const impostos: ImpostoEmAberto[] = impostosDoBanco.map((t) => ({
    id: t.id,
    tributo: t.tributo,
    codigo_receita: t.codigo_receita,
    descricao: t.descricao,
    vencimento: t.vencimento,
    valor: Number(t.valor),
    rateio: (t.rateio ?? []).map((r) => ({ ...r, valor: Number(r.valor) })),
  }));

  let guias: GuiaComEstado[] = [];
  let issRetidoPorParcela = new Map<string, number>();
  let aApurar: SaidaFiscalDoFluxo[] = [];
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
    const [parcelasRes, titulosAApurar] = await Promise.all([
      pps.size > 0
        ? supabase
            .from("pedidos_compra_parcelas")
            .select("id, pedido_compra_id")
            .in("pedido_compra_id", [...pps.keys()])
            .is("pago_em", null)
        : Promise.resolve(null),
      // A PJ do lucro presumido pelo caixa: os títulos em aberto das notas dela.
      carregarTitulosAApurar(supabase, tenantId, fatos.cadastro, fatos.fatos, hoje).catch((e: unknown) => {
        console.error("[fluxo-fiscal.a-apurar]", e instanceof Error ? e.message : e);
        return [] as TituloAApurar[];
      }),
    ]);
    if (parcelasRes) {
      if (parcelasRes.error) console.error("[fluxo-fiscal.parcelas]", parcelasRes.error.message);
      issRetidoPorParcela = new Map(
        ((parcelasRes.data ?? []) as Array<{ id: string; pedido_compra_id: string }>).map((p) => [p.id, pps.get(p.pedido_compra_id) ?? 0]),
      );
    }
    try {
      const blocos = blocosAApurar(fatos.cadastro, fatos.fatos, titulosAApurar, hoje);
      // Decisão 277 §8: o IRPJ/CSLL a apurar no recebimento é estimativa — fica
      // fora do fluxo até a guia ser aprovada (a planilha cobre até lá).
      aApurar = saidasAApurar(blocos, [], hoje);
    } catch (e) {
      console.error("[fluxo-fiscal.a-apurar]", e instanceof Error ? e.message : e);
      aApurar = [];
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

  // Decisão 277 §8: a estimativa de IRPJ/CSLL não entra antes da aprovação;
  // o ISS, o PIS e a COFINS do Fiscal tiram a previsão da planilha do mesmo
  // CNPJ, imposto e mês, e o título de IRPJ/CSLL, a do mesmo trimestre.
  const guiasNoFluxo = guias.filter((g) => !TRIBUTOS_SO_APROVADOS_NO_FLUXO.has(g.tributo));
  const chaves = chavesDoFiscalNoFluxo(guiasNoFluxo, impostosDoBanco);

  const dentro = (s: SaidaFiscalDoFluxo) => s.data_evento >= janela.inicio && s.data_evento <= janela.fim;
  return {
    saidas: [
      ...saidasDosImpostosAPagar(impostos),
      ...saidasDaApuracao(guiasNoFluxo, hoje),
      ...aApurar,
      ...saidasDoCronogramaDeImpostos(cronograma, hoje),
    ].filter(dentro),
    issRetidoPorParcela,
    baixaDoLancamento,
    previsoesDaPlanilhaQueSaem: previsoesDaPlanilhaQueSaem(previsoesDaPlanilha, chaves),
  };
}
