import { createClient } from "@/lib/supabase/server";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import type { TipoCusto } from "@/lib/types";
import {
  contatosDeCobrancaPorJob,
  type ContatoCobranca,
} from "@/lib/data/contatos-cobranca";

/**
 * Um job na fila de abertura, com tudo que a conferência do financeiro
 * precisa mostrar antes de abrir. Os campos de planilha vêm agregados de
 * `jobs_itens_orcado` — a query da lista NÃO faz embed dos itens, que em
 * job grande passa de 40 linhas por job só para exibir um total.
 */
export interface JobNaFila {
  id: string;
  codigo: string;
  nome: string;
  valor_total: number | null;
  /** O que a California emite nota — difere do valor total pelos custos
   *  que o cliente paga direto ao fornecedor (A, D, F). */
  faturamento_previsto: number | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  data_prevista_faturamento: string | null;
  observacoes: string | null;
  created_at: string;
  produto: string | null;
  cidade: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  /** Cliente do projeto de produção. Filtra o combo de projeto do
   *  financeiro e vira o `cliente_id` do projeto criado ali. */
  cliente_id: string | null;
  cliente_nome: string | null;
  /**
   * Projeto na visão do financeiro (`projetos_financeiro`). Independente
   * de `projeto_id`, que é o da produção — o financeiro reagrupa sem que
   * a produção enxergue (migration 20260820000011).
   */
  projeto_financeiro_id: string | null;
  projeto_financeiro_codigo: string | null;
  projeto_financeiro_nome: string | null;
  /** Conta em que o faturamento deste job entra. Uma para o job todo. */
  conta_recebimento_id: string | null;
  /** Conta de onde os custos deste job saem. Uma para o job todo. */
  conta_pagamento_id: string | null;
  regional_nome: string | null;
  responsavel_nome: string | null;
  produtor_nome: string | null;
  orcamento_codigo: string | null;
  /**
   * Categoria do job, herdada do orçamento de origem (categorias_dominio,
   * escopo 'orcamento'). Na fila, `jobs.categoria_id` ainda é null — quem
   * grava é a abertura, e é este valor que ela chega pré-selecionando.
   */
  categoria_id: string | null;
  categoria_nome: string | null;
  /** Agregados da planilha interna do job. */
  planilha_grupos: number;
  planilha_itens: number;
  planilha_orcado: number;
  /** Planejado de TODOS os tipos — controle interno da planilha. */
  planilha_planejado: number;
  /** Planejado só dos tipos de calha PP (AR, B, C, F, FI) — o que a
   *  California de fato desembolsa. Vira o custo previsto na abertura
   *  (docs/decisions/004). */
  planilha_desembolso: number;
  /** Quem o financeiro procura para receber. A produção informa no envio
   *  (docs/decisions/012); job anterior a 17/08/2026 vem com lista
   *  vazia, que é estado legítimo. */
  contatos: ContatoCobranca[];
  /** Preenchido só quando o job está no mural por causa de uma errata. */
  revisao: RevisaoDeErrata | null;
}

/**
 * A errata que devolveu um job JÁ ABERTO ao mural.
 *
 * O job não voltou para a fila de aberturas novas — ele continua aberto e
 * a produção continua trabalhando nele. O que voltou é a conferência: a
 * errata mexeu no orçado, e previsão de recebimento, curva de desembolso e
 * competência foram calculadas sobre os números antigos (27/08/2026).
 */
export interface RevisaoDeErrata {
  errataId: string;
  /** A descrição escrita no pop-up de confirmação da errata. */
  descricao: string;
  autorNome: string | null;
  em: string;
  faturamentoAntes: number | null;
  faturamentoDepois: number | null;
  valorJobAntes: number;
  valorJobDepois: number;
  linhasAlteradas: number;
  linhasNovas: number;
  linhasRemovidas: number;
}

export interface TotaisPlanilhaJob {
  grupos: number;
  itens: number;
  orcado: number;
  planejado: number;
  desembolso: number;
}

const SELECT_JOB_FILA =
  "id, codigo, nome, valor_total, faturamento_previsto, data_inicio_prevista, data_fim_prevista, " +
  "data_prevista_faturamento, observacoes, created_at, produto, cidade, projeto_id, " +
  "projeto_financeiro_id, conta_recebimento_id, conta_pagamento_id, " +
  "projeto:projetos(codigo, nome, cliente_id, cliente:clientes(nome_fantasia)), " +
  "projeto_financeiro:projetos_financeiro(codigo, nome), " +
  "regional:regionais(nome), " +
  "responsavel:profiles!responsavel_id(nome), " +
  "produtor:profiles!produtor_id(nome), " +
  // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`
  // desde 02/09/2026 (categoria e servico).
  "orcamento:orcamentos(codigo, categoria_id, categoria:categorias_dominio!categoria_id(nome))";

/**
 * Soma o orçado e o planejado da planilha interna de vários jobs numa
 * query só. Chave do mapa é o job_id.
 */
export async function totaisDasPlanilhas(
  jobIds: string[],
): Promise<Map<string, TotaisPlanilhaJob>> {
  const mapa = new Map<string, TotaisPlanilhaJob>();
  if (jobIds.length === 0) return mapa;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("jobs_itens_orcado")
    .select("job_id, grupo_id, tipo_custo, total_orcado, total_planejado")
    .in("job_id", jobIds);

  if (error) {
    console.error("[abertura-job.totais-planilha]", error.message);
    return mapa;
  }

  const gruposPorJob = new Map<string, Set<string>>();

  for (const linha of (data ?? []) as {
    job_id: string;
    grupo_id: string | null;
    tipo_custo: TipoCusto;
    total_orcado: number | string | null;
    total_planejado: number | string | null;
  }[]) {
    const atual = mapa.get(linha.job_id) ?? {
      grupos: 0,
      itens: 0,
      orcado: 0,
      planejado: 0,
      desembolso: 0,
    };
    atual.itens += 1;
    atual.orcado += Number(linha.total_orcado ?? 0);
    atual.planejado += Number(linha.total_planejado ?? 0);
    if (tipoGeraDesembolso(linha.tipo_custo)) {
      atual.desembolso += Number(linha.total_planejado ?? 0);
    }
    mapa.set(linha.job_id, atual);

    if (linha.grupo_id) {
      const vistos = gruposPorJob.get(linha.job_id) ?? new Set<string>();
      vistos.add(linha.grupo_id);
      gruposPorJob.set(linha.job_id, vistos);
    }
  }

  for (const [jobId, vistos] of gruposPorJob) {
    const atual = mapa.get(jobId);
    if (atual) atual.grupos = vistos.size;
  }

  return mapa;
}

function montarJobNaFila(
  j: any,
  totais?: TotaisPlanilhaJob,
  contatos?: ContatoCobranca[],
  revisao?: RevisaoDeErrata | null,
): JobNaFila {
  return {
    id: j.id,
    codigo: j.codigo,
    nome: j.nome,
    valor_total: j.valor_total !== null ? Number(j.valor_total) : null,
    faturamento_previsto:
      j.faturamento_previsto !== null && j.faturamento_previsto !== undefined
        ? Number(j.faturamento_previsto)
        : null,
    data_inicio_prevista: j.data_inicio_prevista,
    data_fim_prevista: j.data_fim_prevista,
    data_prevista_faturamento: j.data_prevista_faturamento,
    observacoes: j.observacoes,
    created_at: j.created_at,
    produto: j.produto,
    cidade: j.cidade,
    projeto_id: j.projeto_id,
    projeto_codigo: j.projeto?.codigo ?? null,
    projeto_nome: j.projeto?.nome ?? null,
    cliente_id: j.projeto?.cliente_id ?? null,
    cliente_nome: j.projeto?.cliente?.nome_fantasia ?? null,
    projeto_financeiro_id: j.projeto_financeiro_id ?? null,
    projeto_financeiro_codigo: j.projeto_financeiro?.codigo ?? null,
    projeto_financeiro_nome: j.projeto_financeiro?.nome ?? null,
    conta_recebimento_id: j.conta_recebimento_id ?? null,
    conta_pagamento_id: j.conta_pagamento_id ?? null,
    regional_nome: j.regional?.nome ?? null,
    responsavel_nome: j.responsavel?.nome ?? null,
    produtor_nome: j.produtor?.nome ?? null,
    orcamento_codigo: j.orcamento?.codigo ?? null,
    categoria_id: j.orcamento?.categoria_id ?? null,
    categoria_nome: j.orcamento?.categoria?.nome ?? null,
    planilha_grupos: totais?.grupos ?? 0,
    planilha_itens: totais?.itens ?? 0,
    planilha_orcado: totais?.orcado ?? 0,
    planilha_planejado: totais?.planejado ?? 0,
    planilha_desembolso: totais?.desembolso ?? 0,
    contatos: contatos ?? [],
    revisao: revisao ?? null,
  };
}

/**
 * Um job específico para a tela de abertura. Devolve também o status
 * cru, porque a página precisa desviar quem chegou num job que já foi
 * aberto ou reprovado por outra pessoa, e o nome de quem enviou o job
 * para abertura — o `created_by` do job, que é quem clicou em "Enviar
 * job para abertura" na tela da versão.
 *
 * O nome sai em query própria, e não em embed: `jobs.created_by` aponta
 * para `auth.users`, não para `profiles`, então o PostgREST não faz o
 * join sozinho. `profiles.id` É o id do usuário de auth.
 */
export async function carregarJobParaAbertura(
  tenantId: string,
  jobId: string,
): Promise<{
  job: JobNaFila;
  status: string;
  enviadoPorNome: string | null;
} | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(`${SELECT_JOB_FILA}, status, created_by`)
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[abertura-job.carregar]", error.message);
    return null;
  }
  if (!data) return null;

  const criadoPor = (data as any).created_by as string | null;

  const [totais, contatos, autorRes] = await Promise.all([
    totaisDasPlanilhas([jobId]),
    contatosDeCobrancaPorJob([jobId], tenantId),
    criadoPor
      ? supabase
          .from("profiles")
          .select("nome")
          .eq("id", criadoPor)
          .maybeSingle<{ nome: string | null }>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (autorRes.error) {
    console.error("[abertura-job.enviado-por]", autorRes.error.message);
  }

  return {
    job: montarJobNaFila(data, totais.get(jobId), contatos.get(jobId)),
    status: (data as any).status,
    enviadoPorNome: autorRes.data?.nome ?? null,
  };
}

/** A fila inteira: jobs aguardando abertura, mais antigos primeiro. */
export async function listarFilaDeAbertura(
  tenantId: string,
): Promise<JobNaFila[]> {
  const supabase = createClient();

  // Duas coortes na mesma fila desde 27/08/2026: os jobs que nunca foram
  // abertos e os que uma errata devolveu para reconferência. O `.or` é o
  // que evita uma segunda query — e `abertura_em_revisao` tem índice
  // parcial próprio (`idx_jobs_abertura_em_revisao`).
  const { data, error } = await supabase
    .from("jobs")
    .select(`${SELECT_JOB_FILA}, abertura_em_revisao, abertura_revisao_desde, abertura_revisao_errata_id`)
    .eq("tenant_id", tenantId)
    .or("status.eq.aguardando_abertura,abertura_em_revisao.is.true")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[abertura-job.fila]", error.message);
    return [];
  }

  const linhas = (data ?? []) as any[];
  const ids = linhas.map((j) => j.id as string);
  const [totais, contatos, revisoes] = await Promise.all([
    totaisDasPlanilhas(ids),
    contatosDeCobrancaPorJob(ids, tenantId),
    revisoesDeErrata(
      linhas
        .filter((j) => j.abertura_revisao_errata_id)
        .map((j) => j.abertura_revisao_errata_id as string),
      tenantId,
    ),
  ]);

  return linhas.map((j) =>
    montarJobNaFila(
      j,
      totais.get(j.id),
      contatos.get(j.id),
      j.abertura_revisao_errata_id
        ? (revisoes.get(j.abertura_revisao_errata_id) ?? null)
        : null,
    ),
  );
}

/**
 * As erratas que devolveram jobs ao mural, numa query só.
 *
 * Uma por job — a última, que é a que `jobs.abertura_revisao_errata_id`
 * guarda. Os itens vêm no mesmo embed porque o mural mostra "1 alterada ·
 * 0 novas · 0 removidas", e uma query por job seria N+1 na tela mais
 * movimentada do financeiro (docs/PERFORMANCE.md, anti-padrão I).
 */
async function revisoesDeErrata(
  errataIds: string[],
  tenantId: string,
): Promise<Map<string, RevisaoDeErrata>> {
  const mapa = new Map<string, RevisaoDeErrata>();
  if (errataIds.length === 0) return mapa;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("jobs_erratas")
    .select(
      "id, titulo, created_at, valor_job_antes, valor_job_depois, " +
        "faturamento_previsto_antes, faturamento_previsto_depois, " +
        "autor:profiles!created_by(nome), itens:jobs_erratas_itens(acao)",
    )
    .eq("tenant_id", tenantId)
    .in("id", errataIds);

  if (error) {
    console.error("[abertura-job.revisoes]", error.message);
    return mapa;
  }

  for (const e of (data ?? []) as any[]) {
    const itens = (e.itens ?? []) as Array<{ acao: string }>;
    const conta = (a: string) => itens.filter((i) => i.acao === a).length;
    mapa.set(e.id, {
      errataId: e.id,
      descricao: e.titulo,
      autorNome: e.autor?.nome ?? null,
      em: e.created_at,
      faturamentoAntes:
        e.faturamento_previsto_antes === null
          ? null
          : Number(e.faturamento_previsto_antes),
      faturamentoDepois:
        e.faturamento_previsto_depois === null
          ? null
          : Number(e.faturamento_previsto_depois),
      valorJobAntes: Number(e.valor_job_antes ?? 0),
      valorJobDepois: Number(e.valor_job_depois ?? 0),
      linhasAlteradas: conta("alterada"),
      linhasNovas: conta("nova"),
      linhasRemovidas: conta("removida"),
    });
  }

  return mapa;
}
