import { createClient } from "@/lib/supabase/server";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import type { CategoriaModeloPlanilha, TipoCusto } from "@/lib/types";
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
  /** Conta de onde sai o recolhimento dos impostos (decisão 100). */
  conta_impostos_id: string | null;
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
  /** Modelo de planilha da categoria do ORÇAMENTO de origem — é ele que
   *  decide a cadeia de cálculo do job (decisão 072). A categoria que o
   *  financeiro escolher precisa usar o mesmo modelo; a lista da tela já
   *  vem filtrada por ele, e a server action recusa o resto. */
  modelo_planilha_orcamento: CategoriaModeloPlanilha;
  /**
   * Serviço do job (categorias_dominio, escopo 'projeto'). Na fila vem do
   * orçamento de origem (`orcamentos.servico_id`); no job já aberto vem
   * de `jobs.servico_id`, que a abertura gravou — com o do orçamento como
   * fallback para job aberto antes da decisão 055 (07/09/2026).
   */
  servico_id: string | null;
  servico_nome: string | null;
  /** O serviço que a PRODUÇÃO mandou — o do orçamento, fixo. É o que o
   *  painel "Dados da produção" mostra, ao lado da categoria. */
  servico_producao_nome: string | null;
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
/** Uma errata que a revisão da abertura trata. */
export interface ErrataDaRevisao {
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

/**
 * O que a revisão da abertura trata: TODAS as erratas registradas depois
 * da última foto da abertura (a abertura ou a revisão anterior), da mais
 * antiga à mais recente.
 *
 * Decisão do Tiago em 14/09/2026. Até ali o mural e a revisão mostravam só
 * a última errata (`jobs.abertura_revisao_errata_id`): com duas erratas
 * antes da revisão, a primeira sumia da conferência do financeiro — no
 * teste do JOB-0009, a errata de três linhas desapareceu atrás da de save.
 *
 * Os totais vão da PRIMEIRA errata ("antes", o número que a abertura
 * anterior conhecia) à ÚLTIMA ("depois", o número que a revisão confere).
 */
export interface RevisaoDeErrata {
  erratas: ErrataDaRevisao[];
  faturamentoAntes: number | null;
  faturamentoDepois: number | null;
  valorJobAntes: number | null;
  valorJobDepois: number | null;
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
  "projeto_financeiro_id, conta_recebimento_id, conta_pagamento_id, conta_impostos_id, " +
  // `servico_id` do JOB (decisão 055). A dica `!servico_id` é obrigatória:
  // `jobs` tem duas FKs para `categorias_dominio` desde 07/09/2026.
  "servico_id, servico:categorias_dominio!servico_id(nome), " +
  "projeto:projetos(codigo, nome, cliente_id, cliente:clientes(nome_fantasia)), " +
  "projeto_financeiro:projetos_financeiro(codigo, nome), " +
  "regional:regionais(nome), " +
  "responsavel:profiles!responsavel_id(nome), " +
  "produtor:profiles!produtor_id(nome), " +
  // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`
  // desde 02/09/2026 (categoria e servico).
  "orcamento:orcamentos(codigo, categoria_id, servico_id, " +
  "categoria:categorias_dominio!categoria_id(nome, modelo_planilha), " +
  "servico:categorias_dominio!servico_id(nome))";

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
    conta_impostos_id: j.conta_impostos_id ?? null,
    regional_nome: j.regional?.nome ?? null,
    responsavel_nome: j.responsavel?.nome ?? null,
    produtor_nome: j.produtor?.nome ?? null,
    orcamento_codigo: j.orcamento?.codigo ?? null,
    categoria_id: j.orcamento?.categoria_id ?? null,
    categoria_nome: j.orcamento?.categoria?.nome ?? null,
    // Orçamento antigo, sem categoria, fecha como nacional — que é o que
    // ele sempre fez.
    modelo_planilha_orcamento:
      (j.orcamento?.categoria?.modelo_planilha as
        | CategoriaModeloPlanilha
        | undefined) ?? "nacional",
    servico_id: j.servico_id ?? j.orcamento?.servico_id ?? null,
    servico_nome: j.servico_id
      ? (j.servico?.nome ?? null)
      : (j.orcamento?.servico?.nome ?? null),
    servico_producao_nome: j.orcamento?.servico?.nome ?? null,
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
    .select(`${SELECT_JOB_FILA}, abertura_em_revisao, abertura_revisao_desde, abertura_revisao_errata_id, data_abertura_financeiro`)
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
    revisoesPendentes(
      linhas
        .filter((j) => j.abertura_em_revisao === true)
        .map((j) => ({
          id: j.id as string,
          data_abertura_financeiro:
            (j.data_abertura_financeiro as string | null) ?? null,
        })),
      tenantId,
    ),
  ]);

  return linhas.map((j) =>
    montarJobNaFila(
      j,
      totais.get(j.id),
      contatos.get(j.id),
      // Em revisão o job fica na faixa "Erratas" mesmo que a leitura das
      // erratas falhe — cair em "Aberturas novas" mandaria abrir de novo
      // um job que já está aberto.
      j.abertura_em_revisao === true
        ? (revisoes.get(j.id) ?? resumirRevisao([]))
        : null,
    ),
  );
}

/** A revisão pendente de UM job — a página do job no financeiro usa no
 *  modo de revisão (decisão 059). */
export async function revisaoPendenteDoJob(
  jobId: string,
  dataAberturaFinanceiro: string | null,
  tenantId: string,
): Promise<RevisaoDeErrata> {
  const mapa = await revisoesPendentes(
    [{ id: jobId, data_abertura_financeiro: dataAberturaFinanceiro }],
    tenantId,
  );
  return mapa.get(jobId) ?? resumirRevisao([]);
}

function resumirRevisao(erratas: ErrataDaRevisao[]): RevisaoDeErrata {
  const primeira = erratas[0];
  const ultima = erratas[erratas.length - 1];
  const soma = (
    campo: "linhasAlteradas" | "linhasNovas" | "linhasRemovidas",
  ) => erratas.reduce((t, e) => t + e[campo], 0);
  return {
    erratas,
    faturamentoAntes: primeira?.faturamentoAntes ?? null,
    faturamentoDepois: ultima?.faturamentoDepois ?? null,
    valorJobAntes: primeira ? primeira.valorJobAntes : null,
    valorJobDepois: ultima ? ultima.valorJobDepois : null,
    linhasAlteradas: soma("linhasAlteradas"),
    linhasNovas: soma("linhasNovas"),
    linhasRemovidas: soma("linhasRemovidas"),
  };
}

/**
 * As erratas pendentes de revisão de vários jobs, em duas queries — o
 * mural é a tela mais movimentada do financeiro, e uma query por job seria
 * N+1 (docs/PERFORMANCE.md, anti-padrão I).
 *
 * "Pendente" = registrada depois da última foto da abertura do job. Toda
 * errata em job aberto devolve o job ao mural, e toda gravação do registro
 * com o job em revisão É a revisão (`editarRegistroDaAbertura`), então a
 * janela entre a última foto e agora contém exatamente as erratas que
 * ninguém conferiu ainda. Sem foto, vale a data de abertura.
 */
async function revisoesPendentes(
  jobs: Array<{ id: string; data_abertura_financeiro: string | null }>,
  tenantId: string,
): Promise<Map<string, RevisaoDeErrata>> {
  const mapa = new Map<string, RevisaoDeErrata>();
  if (jobs.length === 0) return mapa;

  const supabase = createClient();
  const ids = jobs.map((j) => j.id);

  const [fotosRes, erratasRes] = await Promise.all([
    supabase
      .from("jobs_aberturas")
      .select("job_id, registrado_em")
      .eq("tenant_id", tenantId)
      .in("job_id", ids),
    supabase
      .from("jobs_erratas")
      .select(
        "id, job_id, titulo, created_at, valor_job_antes, valor_job_depois, " +
          "faturamento_previsto_antes, faturamento_previsto_depois, " +
          "autor:profiles!created_by(nome), itens:jobs_erratas_itens(acao)",
      )
      .eq("tenant_id", tenantId)
      .in("job_id", ids)
      .order("created_at", { ascending: true }),
  ]);

  if (fotosRes.error) {
    console.error("[abertura-job.revisoes.fotos]", fotosRes.error.message);
  }
  if (erratasRes.error) {
    console.error("[abertura-job.revisoes]", erratasRes.error.message);
    return mapa;
  }

  // O limite de cada job: a foto mais recente, ou a data de abertura.
  const limite = new Map<string, number>();
  for (const j of jobs) {
    if (j.data_abertura_financeiro) {
      limite.set(j.id, new Date(j.data_abertura_financeiro).getTime());
    }
  }
  for (const f of (fotosRes.data ?? []) as Array<{
    job_id: string;
    registrado_em: string;
  }>) {
    const t = new Date(f.registrado_em).getTime();
    if (t > (limite.get(f.job_id) ?? -Infinity)) limite.set(f.job_id, t);
  }

  const porJob = new Map<string, ErrataDaRevisao[]>();
  for (const e of (erratasRes.data ?? []) as any[]) {
    const desde = limite.get(e.job_id);
    if (desde !== undefined && new Date(e.created_at).getTime() <= desde) {
      continue;
    }
    const itens = (e.itens ?? []) as Array<{ acao: string }>;
    const conta = (a: string) => itens.filter((i) => i.acao === a).length;
    const lista = porJob.get(e.job_id) ?? [];
    lista.push({
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
    porJob.set(e.job_id, lista);
  }

  for (const j of jobs) {
    mapa.set(j.id, resumirRevisao(porJob.get(j.id) ?? []));
  }
  return mapa;
}
