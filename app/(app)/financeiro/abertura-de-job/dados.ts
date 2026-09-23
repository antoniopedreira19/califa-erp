import { createClient } from "@/lib/supabase/server";
import {
  calcularTotaisVersao,
  tipoGeraDesembolso,
} from "@/lib/calculos/versao-totais";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import type {
  CategoriaModeloPlanilha,
  OrigemDeSave,
  SaveAprovacaoMomento,
  SaveAprovacaoTipo,
  TipoCusto,
} from "@/lib/types";
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
  /**
   * As linhas com save (gerado ou consumido) da planilha — o bloco "Saves
   * deste job" da conferência (decisão 099). Só vem preenchido para o job
   * que aguarda abertura; nos outros é `[]`, que é o valor neutro: a
   * conferência só existe antes de abrir.
   */
  saves: SaveDaConferencia[];
}

/**
 * Uma linha do job com save, como a conferência mostra (decisão 099).
 * Não é pedido: na pré-abertura o save ainda não foi enviado — ele entra
 * na faixa Saves quando o financeiro registra a abertura.
 */
export interface SaveDaConferencia {
  /** `jobs_itens_orcado.id`. */
  id: string;
  tipo: SaveAprovacaoTipo;
  grupoNome: string | null;
  item: string;
  /** Gera: o orçado da linha (o crédito). Consome: o consumido. */
  valor: number;
  /** Consome: de qual job vem o saldo, maior primeiro. Gera: `[]`. */
  origens: { jobId: string; codigo: string; valor: number }[];
}

/**
 * Um pedido de save que aguarda o financeiro — uma linha da faixa Saves
 * da fila (decisão 099, 22/09/2026). Traz o que o pop-up "Aprovar save" e
 * a recusa mostram, para nenhum dos dois precisar de query própria.
 */
export interface SaveNaFila {
  /** `saves_aprovacoes.id`. */
  id: string;
  jobId: string;
  jobCodigo: string;
  /** Nome do job, o mesmo que a fila mostra nas outras faixas. */
  jobNome: string;
  projetoCodigo: string | null;
  projetoNome: string | null;
  clienteNome: string | null;
  produto: string | null;
  responsavelNome: string | null;
  produtorNome: string | null;
  tipo: SaveAprovacaoTipo;
  momento: SaveAprovacaoMomento;
  itemDescricao: string;
  grupoNome: string | null;
  /** Tipo de custo da linha. `null` quando a linha foi removida. */
  tipoCusto: TipoCusto | null;
  /** Gera: o crédito pedido. Consome: a soma das origens. */
  valor: number;
  /**
   * Gera: o FATURAMENTO desta linha — o que a nota cobra por causa dela
   * (orçado + honorários + impostos, pela cadeia do job). É o segundo
   * número do save: o crédito é `valor`, e este é o que o cliente paga
   * agora. `null` no consumo e na linha removida (sem tipo de custo não
   * há como fechar).
   */
  faturamentoDaLinha: number | null;
  /**
   * Saldo de save APROVADO que o cliente deste job já tem, somando os
   * jobs dele (`vw_saves_por_job.disponivel`, que já desconta o que está
   * reservado por pedido). No `gera`, aprovar soma `valor` a ele.
   */
  saldoDoCliente: number;
  /** Consome: as origens pedidas, com o código e o nome do job, e o saldo
   *  livre de cada uma (com este consumo já reservado). */
  origens: {
    jobId: string;
    codigo: string;
    nome: string;
    valor: number;
    /** `vw_saves_por_job.disponivel` da origem: o que ainda cabe consumir
     *  dela. A reserva deste pedido já saiu daqui. */
    disponivel: number;
  }[];
  enviadoEm: string;
  enviadoPorNome: string | null;
  /** A errata de save que o pedido gerou (só `job_aberto`). */
  errataId: string | null;
  /** Os números antes → depois gravados no pedido. Só exibição. */
  valorJobAntes: number | null;
  valorJobDepois: number | null;
  faturamentoPrevistoAntes: number | null;
  faturamentoPrevistoDepois: number | null;
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
  /** A errata nasceu de um pedido de save (`saves_aprovacoes.errata_id`,
   *  decisão 099) — a "errata de save" do job aberto. */
  deSave: boolean;
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
  /**
   * A revisão existe SÓ por pedidos de save (decisão 099): toda errata
   * pendente nasceu de um pedido, e algum deles ainda aguarda. O job então
   * aparece só na faixa Saves da fila — aprovar o save É registrar a
   * revisão. Mesma regra de `revisaoPendenteDoJob` (`lib/data/saves.ts`),
   * em lote.
   */
  soDeSave: boolean;
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
  "projeto_financeiro_id, conta_recebimento_id, conta_pagamento_id, " +
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
  totais: TotaisPlanilhaJob | undefined,
  contatos: ContatoCobranca[] | undefined,
  revisao: RevisaoDeErrata | null,
  /** As linhas com save da conferência. Obrigatório, e `[]` onde a tela
   *  não mostra o bloco: opcional, ele já tinha sumido de uma chamada sem
   *  ninguém notar (decisão 099, revisão de 22/09/2026). */
  saves: SaveDaConferencia[],
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
    revisao,
    saves,
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
    // Sem revisão e sem o bloco "Saves deste job": os dois são da FILA —
    // a revisão pendente a página do job lê por conta própria, e o bloco
    // de saves mora no pop-up de conferência (decisão 099).
    job: montarJobNaFila(data, totais.get(jobId), contatos.get(jobId), null, []),
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
    // `status` separa quem aguarda abertura (e ganha o bloco "Saves deste
    // job") de quem está em revisão. Sem ele o filtro abaixo nunca casava e
    // o bloco não aparecia — a linha é `any`, e nada acusava.
    .select(`${SELECT_JOB_FILA}, status, abertura_em_revisao, abertura_revisao_desde, abertura_revisao_errata_id, data_abertura_financeiro`)
    .eq("tenant_id", tenantId)
    .or("status.eq.aguardando_abertura,abertura_em_revisao.is.true")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[abertura-job.fila]", error.message);
    return [];
  }

  const linhas = (data ?? []) as any[];
  const ids = linhas.map((j) => j.id as string);
  // O bloco "Saves deste job" da conferência (decisão 099) só existe para
  // quem ainda aguarda abertura: no job em revisão o save já é pedido, e
  // aparece na faixa Saves.
  const idsAguardando = linhas
    .filter((j) => j.status === "aguardando_abertura")
    .map((j) => j.id as string);
  const [totais, contatos, revisoes, saves] = await Promise.all([
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
    savesDaConferencia(idsAguardando, tenantId),
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
        ? (revisoes.get(j.id) ?? resumirRevisao([], false))
        : null,
      saves.get(j.id) ?? [],
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
  return mapa.get(jobId) ?? resumirRevisao([], false);
}

function resumirRevisao(
  erratas: ErrataDaRevisao[],
  soDeSave: boolean,
): RevisaoDeErrata {
  const primeira = erratas[0];
  const ultima = erratas[erratas.length - 1];
  const soma = (
    campo: "linhasAlteradas" | "linhasNovas" | "linhasRemovidas",
  ) => erratas.reduce((t, e) => t + e[campo], 0);
  return {
    erratas,
    soDeSave,
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

  const [fotosRes, erratasRes, pedidosRes] = await Promise.all([
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
    // Os pedidos de save que nasceram com uma errata (decisão 099): é por
    // eles que a fila separa a revisão causada só por save. Pelos jobs, e
    // não pelas erratas, para rodar junto das outras duas.
    supabase
      .from("saves_aprovacoes")
      .select("id, job_id, errata_id, situacao")
      .eq("tenant_id", tenantId)
      .in("job_id", ids)
      .not("errata_id", "is", null),
  ]);

  if (pedidosRes.error) {
    // Sem os pedidos, toda errata conta como errata de valores: o job fica
    // na faixa Erratas, que é o caminho que sempre funcionou.
    console.error("[abertura-job.revisoes.pedidos]", pedidosRes.error.message);
  }
  const pedidosPorErrata = new Map<string, string[]>();
  for (const p of (pedidosRes.data ?? []) as Array<{
    errata_id: string;
    situacao: string;
  }>) {
    const lista = pedidosPorErrata.get(p.errata_id) ?? [];
    lista.push(p.situacao);
    pedidosPorErrata.set(p.errata_id, lista);
  }

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
      deSave: pedidosPorErrata.has(e.id),
    });
    porJob.set(e.job_id, lista);
  }

  for (const j of jobs) {
    const erratas = porJob.get(j.id) ?? [];
    // Só de save: toda errata pendente nasceu de um pedido, e algum pedido
    // dessas erratas ainda aguarda. Sem nada aguardando a revisão não se
    // resolve pela faixa Saves — fica em Erratas, para poder ser fechada.
    const soDeSave =
      erratas.length > 0 &&
      erratas.every((e) => e.deSave) &&
      erratas.some((e) =>
        (pedidosPorErrata.get(e.errataId) ?? []).includes("aguardando"),
      );
    mapa.set(j.id, resumirRevisao(erratas, soDeSave));
  }
  return mapa;
}

/**
 * As linhas com save de vários jobs que aguardam abertura — o bloco
 * "Saves deste job" da conferência (decisão 099). Duas queries em lote:
 * as linhas, e depois as origens dos consumos com o código do job.
 */
async function savesDaConferencia(
  jobIds: string[],
  tenantId: string,
): Promise<Map<string, SaveDaConferencia[]>> {
  const mapa = new Map<string, SaveDaConferencia[]>();
  if (jobIds.length === 0) return mapa;

  const supabase = createClient();
  // ⚠️ Dica de FK obrigatória: `jobs_erratas_itens` tem FK para as duas
  // tabelas (linha do job e agrupamento) e o PostgREST a enxerga como
  // tabela de junção — sem a dica o embed fica ambíguo (HTTP 300) e o
  // dado some calado.
  const { data, error } = await supabase
    .from("jobs_itens_orcado")
    .select(
      "id, job_id, item, total_orcado, em_save, save_consumido, ordem, grupo:versoes_orcamento_grupos!jobs_itens_orcado_grupo_id_fkey(nome, ordem)",
    )
    .eq("tenant_id", tenantId)
    .in("job_id", jobIds)
    .or("em_save.eq.true,save_consumido.gt.0");
  if (error) {
    console.error("[abertura-job.saves-conferencia]", error.message);
    return mapa;
  }
  const linhas = (data ?? []) as any[];
  if (linhas.length === 0) return mapa;

  const consumidoras = linhas.filter((l) => l.em_save !== true).map((l) => l.id as string);
  const origensPorLinha = new Map<string, { jobId: string; valor: number }[]>();
  const codigos = new Map<string, string>();
  if (consumidoras.length > 0) {
    const { data: consumos, error: consumosErr } = await supabase
      .from("saves_consumos")
      .select("job_item_orcado_id, job_origem_id, valor")
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", consumidoras);
    if (consumosErr) {
      console.error("[abertura-job.saves-conferencia.consumos]", consumosErr.message);
    }
    for (const c of (consumos ?? []) as any[]) {
      const lista = origensPorLinha.get(c.job_item_orcado_id) ?? [];
      const ja = lista.find((o) => o.jobId === c.job_origem_id);
      if (ja) ja.valor += Number(c.valor ?? 0);
      else lista.push({ jobId: c.job_origem_id, valor: Number(c.valor ?? 0) });
      origensPorLinha.set(c.job_item_orcado_id, lista);
    }
    const idsOrigem = [
      ...new Set([...origensPorLinha.values()].flat().map((o) => o.jobId)),
    ];
    if (idsOrigem.length > 0) {
      const { data: jobsOrigem } = await supabase
        .from("jobs")
        .select("id, codigo")
        .in("id", idsOrigem);
      for (const j of (jobsOrigem ?? []) as any[]) codigos.set(j.id, j.codigo);
    }
  }

  // Na ordem da planilha: agrupamento, depois item.
  linhas.sort(
    (a, b) =>
      Number(a.grupo?.ordem ?? 0) - Number(b.grupo?.ordem ?? 0) ||
      Number(a.ordem ?? 0) - Number(b.ordem ?? 0),
  );
  for (const l of linhas) {
    const gera = l.em_save === true;
    const lista = mapa.get(l.job_id) ?? [];
    lista.push({
      id: l.id,
      tipo: gera ? "gera" : "consome",
      grupoNome: l.grupo?.nome ?? null,
      item: l.item,
      valor: gera ? Number(l.total_orcado ?? 0) : Number(l.save_consumido ?? 0),
      origens: gera
        ? []
        : (origensPorLinha.get(l.id) ?? [])
            .map((o) => ({ ...o, codigo: codigos.get(o.jobId) ?? "—" }))
            .sort((a, b) => b.valor - a.valor),
    });
    mapa.set(l.job_id, lista);
  }
  return mapa;
}

/**
 * O FATURAMENTO de uma linha em save: o que a nota cobra por causa dela
 * (decisão 028 §4 — o crédito é o orçado; isto é orçado + honorários +
 * impostos). É o mesmo fechamento do job, rodado sobre a base do save
 * sozinha — a mesma conta de `save.receita`, e não uma fórmula nova.
 *
 * `null` sem tipo de custo (linha removida depois do pedido): sem ele não
 * há alavanca para fechar, e um número inventado seria pior que nenhum.
 */
function faturamentoDaLinhaEmSave(
  valor: number,
  tipoCusto: TipoCusto | null,
  versao: {
    percentual_honorarios: number | string | null;
    percentual_imposto: number | string | null;
    percentual_int_taxes: number | string | null;
    int_transaction_costs: number | string | null;
    moeda_estrangeira: string | null;
    cambio_compra: number | string | null;
  } | null,
  modelo: CategoriaModeloPlanilha | null,
): number | null {
  if (!tipoCusto || !versao) return null;
  const planilha = configDaPlanilha(modelo, {
    percentual_int_taxes: Number(versao.percentual_int_taxes ?? 0),
    int_transaction_costs: Number(versao.int_transaction_costs ?? 0),
    moeda_estrangeira: versao.moeda_estrangeira ?? null,
    cambio_compra:
      versao.cambio_compra === null || versao.cambio_compra === undefined
        ? null
        : Number(versao.cambio_compra),
  });
  const totais = calcularTotaisVersao(
    [{ tipo_custo: tipoCusto, total_orcado: valor, em_save: true }],
    Number(versao.percentual_honorarios ?? 0),
    Number(versao.percentual_imposto ?? 0),
    planilha.internacional,
  );
  return Math.round(totais.save.receita * 100) / 100;
}

/**
 * A faixa Saves da fila: todo pedido de save que aguarda o financeiro,
 * mais antigos primeiro (decisão 099, 22/09/2026).
 *
 * `saves_aprovacoes` tem quatro FKs para `profiles`: nada de embed a
 * partir dela. Os nomes, os jobs e as linhas saem em consultas próprias,
 * em paralelo. A policy de SELECT do pedido já exige que quem consulta
 * enxergue o job — a faixa não mostra save de job fora do escopo.
 */
export async function listarSavesNaFila(tenantId: string): Promise<SaveNaFila[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("saves_aprovacoes")
    .select(
      "id, job_id, job_item_orcado_id, item_descricao, grupo_nome, tipo, momento, valor, origens, enviado_por, enviado_em, errata_id, valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois",
    )
    .eq("tenant_id", tenantId)
    .eq("situacao", "aguardando")
    .order("enviado_em", { ascending: true });
  if (error) {
    console.error("[abertura-job.saves-fila]", error.message);
    return [];
  }
  const pedidos = (data ?? []) as any[];
  if (pedidos.length === 0) return [];

  const idsJobs = [...new Set(pedidos.map((p) => p.job_id as string))];
  const idsOrigem = [
    ...new Set(
      pedidos.flatMap((p) =>
        ((p.origens ?? []) as OrigemDeSave[]).map((o) => o.job_origem_id),
      ),
    ),
  ];
  const idsPessoas = [
    ...new Set(pedidos.map((p) => p.enviado_por as string | null).filter(Boolean)),
  ] as string[];
  const idsLinhas = [
    ...new Set(
      pedidos.map((p) => p.job_item_orcado_id as string | null).filter(Boolean),
    ),
  ] as string[];

  const [jobsRes, origensRes, pessoasRes, linhasRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, produto, " +
          "projeto:projetos(codigo, nome, cliente_id, cliente:clientes(nome_fantasia)), " +
          "responsavel:profiles!responsavel_id(nome), " +
          "produtor:profiles!produtor_id(nome), " +
          // A cadeia do fechamento, para o "Faturamento desta linha" do
          // pop-up de aprovação. ⚠️ Dicas de FK obrigatórias: há duas FKs
          // entre `jobs` e `versoes_orcamento`, e o modelo de planilha vem
          // da categoria do ORÇAMENTO, nunca da do job (decisão 072).
          "versao:versoes_orcamento!jobs_versao_orcamento_aprovada_id_fkey(percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra), " +
          "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
      )
      .eq("tenant_id", tenantId)
      .in("id", idsJobs),
    idsOrigem.length
      ? supabase.from("jobs").select("id, codigo, nome").in("id", idsOrigem)
      : Promise.resolve({ data: [] as any[], error: null }),
    idsPessoas.length
      ? supabase.from("profiles").select("id, nome").in("id", idsPessoas)
      : Promise.resolve({ data: [] as any[], error: null }),
    idsLinhas.length
      ? supabase
          .from("jobs_itens_orcado")
          .select("id, tipo_custo")
          .eq("tenant_id", tenantId)
          .in("id", idsLinhas)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  for (const [rotulo, r] of [
    ["jobs", jobsRes],
    ["origens", origensRes],
    ["pessoas", pessoasRes],
    ["linhas", linhasRes],
  ] as const) {
    if (r.error) console.error(`[abertura-job.saves-fila.${rotulo}]`, r.error.message);
  }

  const jobs = new Map<string, any>(
    ((jobsRes.data ?? []) as any[]).map((j) => [j.id, j]),
  );
  const origens = new Map<string, { codigo: string; nome: string }>(
    ((origensRes.data ?? []) as any[]).map((j) => [
      j.id,
      { codigo: j.codigo ?? "—", nome: j.nome ?? "" },
    ]),
  );
  const pessoas = new Map<string, string | null>(
    ((pessoasRes.data ?? []) as any[]).map((p) => [p.id, p.nome ?? null]),
  );
  const tipos = new Map<string, TipoCusto>(
    ((linhasRes.data ?? []) as any[]).map((l) => [l.id, l.tipo_custo as TipoCusto]),
  );
  const numOuNulo = (v: unknown) =>
    v === null || v === undefined ? null : Number(v);

  // ---- Saldo de save aprovado (decisão 099) ----
  // O pop-up de aprovação mostra o saldo do CLIENTE antes → depois no
  // `gera`, e o saldo livre de cada origem no `consome`. Os dois saem da
  // mesma view (`disponivel` já desconta o que está reservado por pedido
  // aguardando, este inclusive). Depende dos jobs lidos acima — daí a
  // consulta ficar fora do `Promise.all`; é uma só, e os filtros usam os
  // ids que já estão em mãos.
  const clientesDosPedidos = [
    ...new Set(
      [...jobs.values()]
        .map((j) => j.projeto?.cliente_id as string | null)
        .filter(Boolean),
    ),
  ] as string[];
  const disponivelPorJob = new Map<string, number>();
  const disponivelPorCliente = new Map<string, number>();
  if (clientesDosPedidos.length > 0 || idsOrigem.length > 0) {
    let saldos = supabase
      .from("vw_saves_por_job")
      .select("job_id, cliente_id, disponivel")
      .eq("tenant_id", tenantId);
    // As origens são jobs do mesmo cliente (o crédito é dele), mas o
    // filtro leva as duas listas: dado antigo não precisa obedecer à
    // regra de hoje para o número aparecer certo.
    const filtros = [
      clientesDosPedidos.length > 0
        ? `cliente_id.in.(${clientesDosPedidos.join(",")})`
        : null,
      idsOrigem.length > 0 ? `job_id.in.(${idsOrigem.join(",")})` : null,
    ].filter(Boolean);
    saldos = saldos.or(filtros.join(","));
    const { data: saldosData, error: saldosErr } = await saldos;
    if (saldosErr) {
      console.error("[abertura-job.saves-fila.saldos]", saldosErr.message);
    }
    for (const linha of (saldosData ?? []) as any[]) {
      const valor = Number(linha.disponivel ?? 0);
      disponivelPorJob.set(linha.job_id, valor);
      if (linha.cliente_id) {
        disponivelPorCliente.set(
          linha.cliente_id,
          (disponivelPorCliente.get(linha.cliente_id) ?? 0) + valor,
        );
      }
    }
  }

  const saida: SaveNaFila[] = [];
  for (const p of pedidos) {
    const j = jobs.get(p.job_id);
    // Sem o job (fora do escopo de quem consulta), a linha não teria o que
    // mostrar — e a policy do pedido já o esconderia.
    if (!j) continue;
    saida.push({
      id: p.id,
      jobId: p.job_id,
      jobCodigo: j.codigo,
      jobNome: j.nome,
      projetoCodigo: j.projeto?.codigo ?? null,
      projetoNome: j.projeto?.nome ?? null,
      clienteNome: j.projeto?.cliente?.nome_fantasia ?? null,
      produto: j.produto ?? null,
      responsavelNome: j.responsavel?.nome ?? null,
      produtorNome: j.produtor?.nome ?? null,
      tipo: p.tipo as SaveAprovacaoTipo,
      momento: p.momento as SaveAprovacaoMomento,
      itemDescricao: p.item_descricao,
      grupoNome: p.grupo_nome ?? null,
      tipoCusto: p.job_item_orcado_id
        ? (tipos.get(p.job_item_orcado_id) ?? null)
        : null,
      valor: Number(p.valor ?? 0),
      faturamentoDaLinha:
        p.tipo === "gera"
          ? faturamentoDaLinhaEmSave(
              Number(p.valor ?? 0),
              p.job_item_orcado_id
                ? (tipos.get(p.job_item_orcado_id) ?? null)
                : null,
              j.versao ?? null,
              (j.orcamento?.categoria?.modelo_planilha as
                | CategoriaModeloPlanilha
                | undefined) ?? null,
            )
          : null,
      saldoDoCliente: j.projeto?.cliente_id
        ? (disponivelPorCliente.get(j.projeto.cliente_id) ?? 0)
        : 0,
      origens: ((p.origens ?? []) as OrigemDeSave[])
        .map((o) => ({
          jobId: o.job_origem_id,
          codigo: origens.get(o.job_origem_id)?.codigo ?? "—",
          nome: origens.get(o.job_origem_id)?.nome ?? "",
          valor: Number(o.valor ?? 0),
          disponivel: disponivelPorJob.get(o.job_origem_id) ?? 0,
        }))
        .sort((a, b) => b.valor - a.valor),
      enviadoEm: p.enviado_em,
      enviadoPorNome: p.enviado_por ? (pessoas.get(p.enviado_por) ?? null) : null,
      errataId: p.errata_id ?? null,
      valorJobAntes: numOuNulo(p.valor_job_antes),
      valorJobDepois: numOuNulo(p.valor_job_depois),
      faturamentoPrevistoAntes: numOuNulo(p.faturamento_previsto_antes),
      faturamentoPrevistoDepois: numOuNulo(p.faturamento_previsto_depois),
    });
  }
  return saida;
}
