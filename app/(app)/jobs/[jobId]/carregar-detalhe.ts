import { createClient } from "@/lib/supabase/server";
import { nomeVersao } from "@/lib/nome-versao";
import { listActiveMembers } from "@/lib/data/members";
import { contatosDeCobrancaDoJob } from "@/lib/data/contatos-cobranca";
import { montarThreadChat } from "@/lib/data/job-chat";
import { montarThreadChatPPs } from "@/lib/data/job-chat-pps";
import {
  calcularTotaisVersao,
} from "@/lib/calculos/versao-totais";
import { saldosDeSaveDoCliente, saveDoJob } from "@/lib/data/saves";
import { blocosDoItem, somarBlocosDosItens } from "@/lib/calculos/bv-planilha";
import {
  JOB_STATUS_TRANSICOES,
  jobAceitaRealizado,
  jobAceitaAcoesPlanilha,
  PP_STATUS_EM_ABERTO,
  BV_SITUACAO_EM_ABERTO,
} from "@/lib/types";
import type {
  SessionContext,
  Job,
  JobStatus,
  Regional,
  VersaoOrcamentoGrupo,
  ItemPlanilhaJob,
  JobItemRealizado,
  JobErrataComItens,
  PedidoCompra,
  PedidoCompraNaLista,
  Categoria,
  ItemBv,
} from "@/lib/types";
import type { ResumoEncerramento } from "./encerrar-dialog";
import { saldoAFaturarDoJob } from "@/lib/data/saldo-a-faturar";

/**
 * Todo o detalhe de um job, carregado uma vez e servido às duas telas
 * que o mostram.
 *
 * Existe porque o protótipo "Abertura de Job — Financeiro" transformou a
 * tela do job aberto no financeiro numa casca de abas que REUSA
 * Informações, Planilha Interna e Comunicação da página de Jobs
 * (`/jobs/[jobId]`). Reimplementar essas três no financeiro seria manter
 * duas versões da mesma planilha — que foi justamente o que a decisão
 * anterior evitava. Com o carregamento aqui, as duas telas mostram os
 * mesmos números pela mesma conta, e cada uma monta só o cabeçalho e as
 * abas que são dela.
 *
 * O que NÃO mora aqui: o que depende de `searchParams` (aba inicial, link
 * de volta) e o layout. São de cada página.
 */
export type DetalheDoJob = NonNullable<
  Awaited<ReturnType<typeof carregarDetalheDoJob>>
>;

/** Devolve null quando o job não existe no tenant — o 404 é da página. */
export async function carregarDetalheDoJob(
  session: SessionContext,
  jobId: string,
) {
  const supabase = createClient();
  const [jobRes, regionaisRes, responsaveis, contatosCobranca] =
    await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, tenant_id, empresa_id, codigo, nome, produto, cidade, data_inicio_prevista, data_fim_prevista, data_evento, data_prevista_faturamento, observacoes, responsavel_id, produtor_id, valor_total, faturamento_previsto, faturamento_save_previsto, valor_job_abertura, faturamento_previsto_abertura, abertura_em_revisao, abertura_revisao_desde, abertura_revisao_errata_id, status, motivo_rejeicao, projeto_id, orcamento_id, versao_orcamento_aprovada_id, regional_id, categoria_id, competencia_trimestre, competencia_ano, custo_previsto_total, nome_financeiro, data_abertura_financeiro, aberto_por, created_at, updated_at, responsavel:profiles!responsavel_id(id, nome), produtor:profiles!produtor_id(id, nome), regional:regionais(id, nome), categoria:categorias_dominio!categoria_id(id, nome), orcamento:orcamentos(id, codigo, nome, projeto_id), versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome, moeda, percentual_honorarios, percentual_imposto), projeto:projetos(id, codigo, nome, cliente_id, data_inicio_prevista, data_fim_prevista, cliente:clientes(id, nome_fantasia), categoria:categorias_dominio(id, nome))",
      )
      .eq("id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    listActiveMembers(session.activeTenant.id),
    // Contatos que a produção informou no envio para abertura. Uma query
    // só, coberta pelo índice `idx_jobs_contatos_job`.
    contatosDeCobrancaDoJob(jobId, session.activeTenant.id),
  ]);

  if (jobRes.error) console.error("[job.detail]", jobRes.error.message);
  const raw = jobRes.data as any;
  if (!raw) return null;

  // Queries de Realizado (paralelas, dependem de raw ja carregado)
  const versaoAprovadaId = raw.versao_orcamento_aprovada_id as string;

  const [
    gruposRes,
    itensRes,
    realizadosRes,
    ppsRes,
    fornecedoresRes,
    empresasRes,
    categoriasRes,
    erratasRes,
    mensagensRes,
    leituraRes,
    bvsRes,
    mensagensPPsRes,
    leituraPPsRes,
    envioFaturamentoRes,
    portaisRes,
    jobsIrmaosRes,
    abertoPorRes,
  ] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    // Orçado vem da CÓPIA do job, não da versão: a errata altera a cópia e
    // a versão aprovada continua sendo o que o cliente aprovou.
    supabase
      .from("jobs_itens_orcado")
      .select("*")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_itens_realizado")
      .select("*")
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .returns<JobItemRealizado[]>(),
    // Sem filtro de status: a trilha da Planilha Interna usa só as ativas,
    // mas a aba de Pedidos de Produção lista as canceladas também. Uma
    // query só em vez de duas.
    // O embed de parcelas é leve de propósito: uma PP tem 1 a 3 parcelas
    // na prática, e a aba de PPs precisa de TODAS elas (uma linha por
    // vencimento). Query separada aqui só somaria round-trip.
    supabase
      .from("pedidos_compra")
      .select(
        "*, emitido:profiles!emitida_por(nome), responsavel:profiles!responsavel_verba_id(nome), anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes), parcelas:pedidos_compra_parcelas(id, tenant_id, pedido_compra_id, numero, data_vencimento, valor, pdf_path, pago_em, pago_por, created_at, updated_at, created_by)",
      )
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social, status")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia, ativo, principal")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("principal", { ascending: false })
      .order("razao_social"),
    supabase
      .from("categorias")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .returns<Pick<Categoria, "id" | "nome">[]>(),
    supabase
      .from("jobs_erratas")
      .select(
        "*, autor:profiles!created_by(nome), itens:jobs_erratas_itens(*)",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "geral")
      .order("created_at", { ascending: true }),
    supabase
      .from("jobs_chat_leituras")
      .select("lida_ate")
      .eq("job_id", jobId)
      .eq("profile_id", session.profile.id)
      .eq("escopo", "geral")
      .maybeSingle(),
    // BVs ATIVOS deste job. O filtro passou a ser pela CÓPIA do job em
    // 27/08/2026, não mais pela versão: a linha criada por errata não tem
    // item de versão, e pelo caminho antigo (`!inner` em
    // `versoes_orcamento_itens`) ela sumiria da lista em silêncio.
    //
    // Continua sendo o mesmo registro que a tela de Orçamentos abre — quem
    // veio da versão tem as duas chaves preenchidas. O `!inner` é filtro,
    // não embed.
    supabase
      .from("itens_bv")
      .select(
        "id, tenant_id, item_versao_id, job_item_orcado_id, fornecedor_id, valor, prazo_repasse, " +
          "situacao, created_by, created_at, updated_at, " +
          "copia:jobs_itens_orcado!inner(job_id)",
      )
      .eq("copia.job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("situacao", "cancelado"),
    // Mensagens do chat de PPs (escopo='pps'), separadas do chat geral.
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "pps")
      .order("created_at", { ascending: true }),
    // Leitura do usuário no chat de PPs.
    supabase
      .from("jobs_chat_leituras")
      .select("lida_ate")
      .eq("job_id", jobId)
      .eq("profile_id", session.profile.id)
      .eq("escopo", "pps")
      .maybeSingle(),
    // Envio para faturamento: existe no máximo um por job. É ele que
    // decide entre mostrar "Enviar para faturamento" e liberar o
    // encerramento.
    supabase
      .from("jobs_envio_faturamento")
      .select("id, valor_faturado, data_faturamento, numero_po, descricao_nf, portal_url, enviado_em")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    // Portais do cliente, para o formulário de envio.
    supabase
      .from("cliente_portais")
      .select("id, nome, url, cliente:clientes!inner(id)")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    // Irmãos do job na ficha: o projeto é o guarda-chuva, e quem abre um
    // job quer ver de relance o que mais corre debaixo dele. Coberta pelo
    // índice `idx_jobs_projeto`; quatro colunas, sem embed.
    supabase
      .from("jobs")
      .select("id, codigo, nome, status")
      .eq("projeto_id", raw.projeto_id)
      .eq("tenant_id", session.activeTenant.id)
      .order("codigo", { ascending: true }),
    // `aberto_por` NÃO entra como embed: a FK aponta para `auth.users`, e
    // o nome mora em `profiles`. Query própria, e só quando há alguém.
    raw.aberto_por
      ? supabase
          .from("profiles")
          .select("nome")
          .eq("id", raw.aberto_por)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const grupos = (gruposRes.data ?? []) as VersaoOrcamentoGrupo[];
  if (itensRes.error) console.error("[job.orcado]", itensRes.error.message);
  if (bvsRes.error) console.error("[job.bvs]", bvsRes.error.message);
  if (envioFaturamentoRes.error) {
    console.error("[job.envio-faturamento]", envioFaturamentoRes.error.message);
  }

  const envioFaturamento = (envioFaturamentoRes.data as any) ?? null;
  // Só os portais do cliente DESTE job — a consulta traz os do tenant e o
  // filtro por cliente é feito aqui, com o id que já veio no `raw`.
  const portaisDoCliente = ((portaisRes.data ?? []) as any[])
    .filter((p) => p.cliente?.id === raw.projeto?.cliente_id)
    .map((p) => ({ id: p.id, nome: p.nome, url: p.url }));

  // Indexado pela CÓPIA do job: a calha consulta uma chave por linha, e
  // desde 27/08/2026 essa chave é a única que existe em toda linha.
  // Objeto, e não Map, porque só objeto atravessa a fronteira server →
  // client.
  const bvsPorItem: Record<string, ItemBv> = {};
  for (const raw of (bvsRes.data ?? []) as any[]) {
    const { copia: _joinFiltro, ...bv } = raw;
    if (!bv.job_item_orcado_id) continue;
    bvsPorItem[bv.job_item_orcado_id] = { ...bv, valor: Number(bv.valor ?? 0) };
  }
  // `id` é o id da CÓPIA do job — a chave que o realizado, o BV, a PP e o
  // save usam. `orcado_id` carrega o mesmo valor e fica por compatibilidade;
  // `item_versao_id` é `null` na linha que nasceu de uma errata.
  const itens: ItemPlanilhaJob[] = (itensRes.data ?? []).map((it: any) => ({
    id: it.id,
    orcado_id: it.id,
    item_versao_id: it.item_versao_id ?? null,
    linha_vermelha: it.linha_vermelha === true,
    grupo_id: it.grupo_id,
    ordem: Number(it.ordem ?? 0),
    item: it.item,
    tipo_custo: it.tipo_custo,
    categoria_id: it.categoria_id ?? null,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
    // `null` preservado de propósito: significa "ainda não congelado", e
    // é o que manda a conta calcular a dedução a partir do BV vigente.
    em_save: it.em_save === true,
    save_consumido: Number(it.save_consumido ?? 0),
    bv_liquido_planejado:
      it.bv_liquido_planejado === null || it.bv_liquido_planejado === undefined
        ? null
        : Number(it.bv_liquido_planejado),
  }));
  const realizados = (realizadosRes.data ?? []).map((r: any) => ({
    ...r,
    valor_unitario_realizado: Number(r.valor_unitario_realizado ?? 0),
    quantidade_realizada: Number(r.quantidade_realizada ?? 0),
    dias_meses_realizado: Number(r.dias_meses_realizado ?? 0),
    total_realizado: Number(r.total_realizado ?? 0),
  })) as JobItemRealizado[];

  // Chaveado pela cópia do job desde 27/08/2026. A âncora da linha criada
  // por errata não tem `item_id` — a chave antiga seria `null` nela.
  const realizadosMap = new Map<string, JobItemRealizado>();
  for (const r of realizados) {
    if (r.job_item_orcado_id) realizadosMap.set(r.job_item_orcado_id, r);
  }

  if (ppsRes.error) console.error("[job.pps]", ppsRes.error.message);

  // Nome do grupo por item realizado: o realizado aponta pra linha da
  // planilha, que aponta pro grupo. A aba de PPs mostra "{grupo} · emitida
  // em ...".
  const grupoNomePorId = new Map(grupos.map((g) => [g.id, g.nome]));
  const itemPorId = new Map(itens.map((i) => [i.id, i]));
  const grupoPorItemRealizadoId = new Map<string, string>();
  for (const r of realizados) {
    const item = r.job_item_orcado_id
      ? itemPorId.get(r.job_item_orcado_id)
      : undefined;
    const nome = item ? grupoNomePorId.get(item.grupo_id) : undefined;
    if (nome) grupoPorItemRealizadoId.set(r.id, nome);
  }

  const ppsDoJob: PedidoCompraNaLista[] = (ppsRes.data ?? []).map((pp: any) => ({
    ...pp,
    quantidade: Number(pp.quantidade),
    valor: Number(pp.valor),
    emitida_por_nome: pp.emitido?.nome ?? null,
    grupo_nome: grupoPorItemRealizadoId.get(pp.item_realizado_id) ?? null,
    parcelas: (pp.parcelas ?? [])
      .map((p: any) => ({ ...p, valor: Number(p.valor ?? 0) }))
      .sort((a: any, b: any) => a.numero - b.numero),
    anexos: (pp.anexos ?? []).map((a: any) => ({
      id: a.id,
      arquivo_nome_original: a.arquivo_nome_original,
      arquivo_tamanho_bytes: Number(a.arquivo_tamanho_bytes ?? 0),
    })),
  }));

  // Um item pode ter VÁRIAS PPs desde 17/08/2026 (PPs parciais), então o
  // mapa guarda lista. A cancelada fica de fora: ela devolveu saldo ao
  // item e não conta nem no chip nem na conta do painel.
  const ppsPorItemId = new Map<string, PedidoCompraNaLista[]>();
  for (const pp of ppsDoJob) {
    if (pp.status === "cancelada") continue;
    const atuais = ppsPorItemId.get(pp.item_realizado_id) ?? [];
    atuais.push(pp);
    ppsPorItemId.set(pp.item_realizado_id, atuais);
  }

  const fornecedores = (fornecedoresRes.data ?? []) as any[];
  const empresas = (empresasRes.data ?? []) as any[];

  if (categoriasRes.error)
    console.error("[job.categorias]", categoriasRes.error.message);
  const categoriasMap = new Map<string, string>();
  for (const c of categoriasRes.data ?? []) categoriasMap.set(c.id, c.nome);

  if (erratasRes.error) console.error("[job.erratas]", erratasRes.error.message);
  const erratas: JobErrataComItens[] = (erratasRes.data ?? []).map((e: any) => ({
    ...e,
    custo_orcado_antes: Number(e.custo_orcado_antes ?? 0),
    custo_orcado_depois: Number(e.custo_orcado_depois ?? 0),
    valor_job_antes: Number(e.valor_job_antes ?? 0),
    valor_job_depois: Number(e.valor_job_depois ?? 0),
    faturamento_previsto_antes:
      e.faturamento_previsto_antes !== null &&
      e.faturamento_previsto_antes !== undefined
        ? Number(e.faturamento_previsto_antes)
        : null,
    faturamento_previsto_depois:
      e.faturamento_previsto_depois !== null &&
      e.faturamento_previsto_depois !== undefined
        ? Number(e.faturamento_previsto_depois)
        : null,
    autor_nome: e.autor?.nome ?? null,
    itens: (e.itens ?? []).map((i: any) => ({
      ...i,
      valor_unitario_de: Number(i.valor_unitario_de ?? 0),
      valor_unitario_para: Number(i.valor_unitario_para ?? 0),
      total_de: Number(i.total_de ?? 0),
      total_para: Number(i.total_para ?? 0),
      efeito_valor_job: Number(i.efeito_valor_job ?? 0),
      efeito_faturamento_previsto:
        i.efeito_faturamento_previsto !== null &&
        i.efeito_faturamento_previsto !== undefined
          ? Number(i.efeito_faturamento_previsto)
          : null,
    })),
  }));

  const versaoAprovada = raw.versao as {
    id: string;
    numero_versao: number;
    nome: string | null;
    moeda: string;
    percentual_honorarios: number;
    percentual_imposto: number;
  };

  const transicoes = JOB_STATUS_TRANSICOES[raw.status as JobStatus];

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];

  const job: Job = {
    faturamento_save_previsto: Number(raw.faturamento_save_previsto ?? 0),
    abertura_em_revisao: raw.abertura_em_revisao === true,
    abertura_revisao_desde: raw.abertura_revisao_desde ?? null,
    abertura_revisao_errata_id: raw.abertura_revisao_errata_id ?? null,
    id: raw.id,
    tenant_id: raw.tenant_id,
    empresa_id: raw.empresa_id,
    codigo: raw.codigo,
    projeto_id: raw.projeto_id,
    orcamento_id: raw.orcamento_id,
    versao_orcamento_aprovada_id: raw.versao_orcamento_aprovada_id,
    nome: raw.nome,
    produto: raw.produto,
    regional_id: raw.regional_id,
    cidade: raw.cidade,
    data_inicio_prevista: raw.data_inicio_prevista,
    data_fim_prevista: raw.data_fim_prevista,
    responsavel_id: raw.responsavel_id,
    produtor_id: raw.produtor_id,
    valor_total: raw.valor_total !== null ? Number(raw.valor_total) : null,
    faturamento_previsto:
      raw.faturamento_previsto !== undefined &&
      raw.faturamento_previsto !== null
        ? Number(raw.faturamento_previsto)
        : null,
    valor_job_abertura:
      raw.valor_job_abertura !== undefined && raw.valor_job_abertura !== null
        ? Number(raw.valor_job_abertura)
        : null,
    faturamento_previsto_abertura:
      raw.faturamento_previsto_abertura !== undefined &&
      raw.faturamento_previsto_abertura !== null
        ? Number(raw.faturamento_previsto_abertura)
        : null,
    data_evento: raw.data_evento ?? null,
    data_prevista_faturamento: raw.data_prevista_faturamento ?? null,
    observacoes: raw.observacoes ?? null,
    status: raw.status,
    motivo_rejeicao: raw.motivo_rejeicao ?? null,
    // Registro financeiro da abertura. A página de Jobs não exibe estes
    // campos, mas a tela do job no financeiro exibe — e o formulário de
    // abertura em leitura decide pela curva de desembolso a partir de
    // `custo_previsto_total`. Sem eles no select, o job aparecia lá como
    // "sem desembolso previsto" mesmo tendo curva gravada.
    nome_financeiro: raw.nome_financeiro ?? null,
    categoria_id: raw.categoria_id ?? null,
    competencia_trimestre: raw.competencia_trimestre ?? null,
    competencia_ano: raw.competencia_ano ?? null,
    custo_previsto_total:
      raw.custo_previsto_total !== undefined &&
      raw.custo_previsto_total !== null
        ? Number(raw.custo_previsto_total)
        : null,
    data_abertura_financeiro: raw.data_abertura_financeiro ?? null,
    aberto_por: raw.aberto_por ?? null,
    created_by: null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };

  // ---- Comunicação: thread e contador de não lidas ----
  if (mensagensRes.error)
    console.error("[job.mensagens]", mensagensRes.error.message);

  const mensagens = (mensagensRes.data ?? []).map((m: any) => ({
    ...m,
    autor_nome: m.autor?.nome ?? null,
  }));

  const totalOrcadoJob = itens.reduce(
    (s, i) => s + Number(i.total_orcado ?? 0),
    0,
  );

  // Resumo do cabeçalho: mesmas funções do card de Totais da Planilha
  // Interna, pra header e rodapé nunca divergirem.
  const totaisJob = calcularTotaisVersao(
    itens,
    Number(versaoAprovada.percentual_honorarios),
    Number(versaoAprovada.percentual_imposto),
  );
  // Passa pelos blocos com BV, e não pela soma crua das colunas: em `A` e
  // `D` o realizado é o ORÇADO (eles não geram PP e ficam em zero na
  // tabela), e o resumo do cabeçalho precisa bater com o card de Totais
  // da Planilha Interna (docs/decisions/022).
  // "Já aberto" e não "aceita ações": job ENCERRADO continua mostrando o
  // realizado — ele é histórico. O que zera o bloco é a pré-abertura.
  const jobJaAberto =
    raw.status !== "aguardando_abertura" &&
    raw.status !== "rejeitado_financeiro";

  const blocosDoJob = somarBlocosDosItens(
    itens.map((it) =>
      blocosDoItem(
        it,
        bvsPorItem[it.id] ?? null,
        Number(realizadosMap.get(it.id)?.total_realizado ?? 0),
        Number(versaoAprovada.percentual_imposto),
        jobJaAberto,
      ),
    ),
  );
  const custoPlanejadoJob = blocosDoJob.planejado.bruto;
  const custoRealizadoJob = blocosDoJob.realizado.bruto;
  const bvPlanejadoJob = blocosDoJob.planejado.deducaoBv;
  const bvRealizadoJob = blocosDoJob.realizado.deducaoBv;

  const threadChat = montarThreadChat(
    {
      criadoEm: raw.created_at,
      aberturaFinanceiroEm: raw.data_abertura_financeiro ?? null,
      orcamentoCodigo: raw.orcamento?.codigo ?? null,
      versaoNumero: raw.versao?.numero_versao ?? null,
      versaoNome: raw.versao?.nome ?? null,
      valorJobAbertura:
        raw.valor_job_abertura !== null && raw.valor_job_abertura !== undefined
          ? Number(raw.valor_job_abertura)
          : null,
      totalOrcado: totalOrcadoJob,
      qtdItens: itens.length,
      qtdGrupos: grupos.length,
      responsavelNome: raw.responsavel?.nome ?? null,
      dataInicio: raw.data_inicio_prevista,
      dataFim: raw.data_fim_prevista,
    },
    erratas,
    mensagens,
    versaoAprovada.moeda,
  );

  // Não lidas = o que chegou de outra pessoa depois da última leitura.
  // Errata conta junto: é o evento que o outro time mais precisa ver.
  const lidaAte = (leituraRes.data as { lida_ate: string } | null)?.lida_ate ?? null;
  const naoLidas =
    mensagens.filter(
      (m: any) =>
        m.autor_id !== session.profile.id &&
        (!lidaAte || m.created_at > lidaAte),
    ).length +
    erratas.filter(
      (e) => e.created_by !== session.profile.id && (!lidaAte || e.created_at > lidaAte),
    ).length;

  // ---- Chat de PPs: thread e contador de não lidas ----
  if (mensagensPPsRes.error)
    console.error("[job.mensagens_pps]", mensagensPPsRes.error.message);

  const mensagensPPs = (mensagensPPsRes.data ?? []).map((m: any) => ({
    ...m,
    autor_nome: m.autor?.nome ?? null,
  }));

  const fornecedoresPorId: Record<string, string> = Object.fromEntries(
    fornecedores.map((f) => [f.id, f.razao_social ?? f.nome]),
  );

  const threadChatPPs = montarThreadChatPPs(
    ppsDoJob,
    mensagensPPs,
    versaoAprovada.moeda,
    fornecedoresPorId,
  );

  const lidaAtePPs =
    (leituraPPsRes.data as { lida_ate: string } | null)?.lida_ate ?? null;
  const naoLidasPPs = mensagensPPs.filter(
    (m: any) =>
      m.autor_id !== session.profile.id &&
      (!lidaAtePPs || m.created_at > lidaAtePPs),
  ).length;

  // Envio para faturamento: quem produz é quem libera, porque PO, CNAE e
  // portal são informação da produção. Financeiro e admin também podem,
  // para não travar o fluxo quando o GP estiver fora.
  const podeEnviarFaturamento =
    job.status === "aberto" &&
    envioFaturamento === null &&
    totaisJob.faturamentoPrevisto > 0;

  // Job pago INTEIRAMENTE por saldo de save: faturamento previsto zero e
  // consumo registrado. Ele pula a etapa de faturamento e se comporta
  // como já faturado — a nota dele saiu no job que gerou o crédito
  // (decisão do Tiago em 27/08/2026, decisão 028 §11). Sem isto ele
  // travava dos dois lados: não dá para enviar (valor zero) e o
  // encerramento só aparecia depois do envio.
  //
  // A condição é DUPLA de propósito: faturamento zero sem save é outra
  // coisa (orçado vazio), e esse continua tendo de passar pelo
  // faturamento. Mesma régua de `lib/data/faturamento-por-job.ts` e do
  // portão de `encerrarJob`.
  const saveConsumidoNoJob = itens.reduce(
    (soma, it) => soma + Number(it.save_consumido ?? 0),
    0,
  );
  const pagoSoPorSave =
    totaisJob.faturamentoPrevisto <= 0.004 && saveConsumidoNoJob > 0;

  if (jobsIrmaosRes.error)
    console.error("[job.irmaos]", jobsIrmaosRes.error.message);

  const jobsDoProjeto = ((jobsIrmaosRes.data ?? []) as any[]).map((j) => ({
    id: j.id as string,
    codigo: j.codigo as string,
    nome: j.nome as string,
    status: j.status as JobStatus,
  }));

  const abertoPorNome =
    (abertoPorRes.data as { nome: string } | null)?.nome ?? null;

  const versaoLabel = raw.versao
    ? nomeVersao(raw.orcamento?.nome ?? job.nome, raw.versao.numero_versao)
    : "—";

  // Resumo de fechamento. Só existe depois do envio para faturamento —
  // antes disso não há o que encerrar. Os impedimentos saem dos dados que
  // a página já carregou (nenhuma query nova); o servidor refaz a conta
  // na hora de gravar, porque esta tela pode estar velha.
  // Saldo a faturar: as parcelas do envio que ainda não viraram nota
  // emitida. Trava o encerramento junto com PP e BV desde 31/08/2026 —
  // job encerrado sai de `vw_faturamento_pendente` e não volta.
  // Só é lido quando há resumo a montar; nas outras abas seria uma ida ao
  // banco por nada.
  const saldoAFaturar =
    job.status === "aberto" && envioFaturamento
      ? await saldoAFaturarDoJob(session.activeTenant.id, jobId)
      : 0;

  const ppsEmAberto = ppsDoJob
    .filter((pp) => PP_STATUS_EM_ABERTO.includes(pp.status))
    .map((pp) => ({ codigo: pp.codigo, status: pp.status }));
  const nomeDoItem = new Map(itens.map((it) => [it.id, it.item]));
  const bvsEmAberto = Object.entries(bvsPorItem)
    .filter(([, bv]) => BV_SITUACAO_EM_ABERTO.includes(bv.situacao))
    .map(([orcadoId, bv]) => ({
      item: nomeDoItem.get(orcadoId) ?? "Item da planilha",
      situacao: bv.situacao,
    }));

  const resumoEncerramento: ResumoEncerramento | null =
    job.status === "aberto" && (envioFaturamento || pagoSoPorSave)
      ? {
          faturamentoAbertura: job.faturamento_previsto_abertura,
          // "Faturamento" do fechamento é o faturamento previsto de agora,
          // recalculado dos itens — não o número congelado na abertura.
          faturamentoFechamento: totaisJob.faturamentoPrevisto,
          // Sem envio (job que pulou a etapa) não há valor mandado
          // faturar: zero, e o dialog não acusa divergência porque o
          // faturamento previsto também é zero.
          valorEnviado: envioFaturamento
            ? Number(envioFaturamento.valor_faturado)
            : 0,
          orcado: totaisJob.subtotalGeral,
          honorarios: totaisJob.honorarios,
          imposto: totaisJob.imposto,
          percentualHonorarios: Number(versaoAprovada.percentual_honorarios),
          percentualImposto: Number(versaoAprovada.percentual_imposto),
          valorJob: totaisJob.valorJob,
          custoRealizado: custoRealizadoJob,
          saveConsumido: saveConsumidoNoJob,
          moeda: versaoAprovada.moeda,
          ppsEmAberto,
          bvsEmAberto,
          saldoAFaturar,
        }
      : null;

  // Mesmo perfil de permissão nos dois flags — o que muda é o status.
  // O realizado passou a valer antes da abertura (17/08/2026); errata,
  // BV e PP continuam presos ao job já aberto pelo financeiro. As duas
  // regras moram em `lib/types.ts`, que é de onde as server actions leem.
  const quemPodeMexer =
    session.activeRole === "administrador" ||
    job.responsavel_id === session.profile.id;

  const podeEditarRealizado = quemPodeMexer && jobAceitaRealizado(job.status);
  const podeAcoesPlanilha = quemPodeMexer && jobAceitaAcoesPlanilha(job.status);
  // SAVE — o crédito entre jobs. As duas leituras vão juntas: uma em
  // série apareceria no TTFB da tela mais pesada do job.
  const clienteIdDoJob: string = raw.projeto?.cliente_id ?? "";
  const [savePorItem, saldosDeSave] = await Promise.all([
    saveDoJob(supabase, session.activeTenant.id, jobId, itens),
    clienteIdDoJob
      ? saldosDeSaveDoCliente(
          supabase,
          session.activeTenant.id,
          clienteIdDoJob,
          // Ninguém consome o próprio saldo.
          jobId,
        )
      : Promise.resolve([]),
  ]);

  return {
    raw,
    savePorItem,
    saldosDeSave,
    clienteNome: raw.projeto?.cliente?.nome_fantasia ?? "—",
    job,
    grupos,
    itens,
    realizadosMap,
    categoriasMap,
    erratas,
    versaoAprovada,
    versaoLabel,
    regionais,
    responsaveis,
    contatosCobranca,
    transicoes,
    ppsDoJob,
    ppsPorItemId,
    fornecedores,
    fornecedoresPorId,
    empresas,
    bvsPorItem,
    threadChat,
    naoLidas,
    threadChatPPs,
    naoLidasPPs,
    envioFaturamento,
    podeEnviarFaturamento,
    pagoSoPorSave,
    portaisDoCliente,
    jobsDoProjeto,
    abertoPorNome,
    totaisJob,
    custoPlanejadoJob,
    custoRealizadoJob,
    bvPlanejadoJob,
    bvRealizadoJob,
    resumoEncerramento,
    podeEditarRealizado,
    podeAcoesPlanilha,
  };
}
