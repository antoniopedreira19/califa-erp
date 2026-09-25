import { createClient } from "@/lib/supabase/server";
import { nomeVersao } from "@/lib/nome-versao";
import { pode } from "@/lib/permissoes";
import { listActiveMembers } from "@/lib/data/members";
import { contatosDeCobrancaDoJob } from "@/lib/data/contatos-cobranca";
import {
  lerRecusasDeSaveDoJob,
  montarThreadChat,
  recusasDeSaveNaoLidas,
} from "@/lib/data/job-chat";
import { montarThreadChatPPs } from "@/lib/data/job-chat-pps";
import {
  SELECT_PRESTACAO_DA_VERBA,
  devolucaoDaVerba,
  prestacaoDaVerba,
} from "@/lib/data/prestacao-da-verba";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import {
  calcularTotaisVersao,
} from "@/lib/calculos/versao-totais";
import { itemPrecisaDeConclusao } from "@/lib/calculos/pps-item";
import { saldosDeSaveDoCliente, saveDoJob } from "@/lib/data/saves";
import { blocosDoItem, somarBlocosDosItens } from "@/lib/calculos/bv-planilha";
import {
  JOB_STATUS_TRANSICOES,
  jobAceitaRealizado,
  jobAceitaEnvioParaFaturamento,
  jobAceitaAcoesPlanilha,
  jobAceitaGerarPP,
  jobAceitaEnvioDePP,
  jobStatusExibido,
  PP_STATUS_EM_ABERTO,
  situacaoDaVerba,
  verbaPendenteNoEncerramento,
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
  JobCompetencia,
  PedidoCompra,
  PedidoCompraNaLista,
  Categoria,
  ItemBv,
  CategoriaModeloPlanilha,
} from "@/lib/types";
import type { FechamentoDoJob } from "./enviar-encerramento-dialog";
import { saldoAFaturarDoJob } from "@/lib/data/saldo-a-faturar";
import {
  COLUNAS_DE_PAGAMENTO,
  cadastroMudouDepoisDaFoto,
  type DadosDePagamento,
} from "@/lib/data/foto-pagamento-da-pp";
import { mesesDaVersaoQuery } from "@/lib/data/meses-versao";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import {
  montarFaturamentoDoEnvioUnico,
  montarFaturamentoMensal,
  type EnvioDoJobComParcelas,
  type FaturamentoDoEnvioUnico,
  type ItemDeNotaDaParcela,
  type MesDeFaturamento,
} from "@/lib/calculos/faturamento-por-mes";

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
    // O Serviço vem do JOB (`jobs.servico_id`, gravado na abertura —
    // decisão 055, 07/09/2026), com o do ORÇAMENTO (`orcamentos.servico_id`)
    // como fallback para job ainda na fila. Não vem mais da categoria do
    // projeto: desde 02/09/2026 (migration `20260902110001`) o Serviço
    // desceu do projeto para o orçamento e `projetos.categoria_id` ficou
    // legada. As dicas `!categoria_id` / `!servico_id` são obrigatórias:
    // `jobs` e `orcamentos` têm duas FKs cada para `categorias_dominio`,
    // e sem elas o embed fica ambíguo.
    supabase
      .from("jobs")
      .select(
        "id, tenant_id, empresa_id, codigo, nome, produto, cidade, data_inicio_prevista, data_fim_prevista, data_evento, data_prevista_faturamento, observacoes, responsavel_id, produtor_id, valor_total, faturamento_previsto, faturamento_save_previsto, valor_job_abertura, faturamento_previsto_abertura, abertura_em_revisao, abertura_revisao_desde, abertura_revisao_errata_id, status, encerrado_em, encerrado_por, finalizado_em, faturamento_enviado_em, motivo_rejeicao, projeto_id, orcamento_id, versao_orcamento_aprovada_id, regional_id, categoria_id, servico_id, competencia_trimestre, competencia_ano, custo_previsto_total, nome_financeiro, data_abertura_financeiro, aberto_por, created_at, updated_at, responsavel:profiles!responsavel_id(id, nome), produtor:profiles!produtor_id(id, nome), encerrado_por_perfil:profiles!encerrado_por(nome), regional:regionais(id, nome), categoria:categorias_dominio!categoria_id(id, nome), servico:categorias_dominio!servico_id(id, nome), orcamento:orcamentos(id, codigo, nome, projeto_id, servico:categorias_dominio!servico_id(id, nome, investimento_interno), categoria:categorias_dominio!categoria_id(modelo_planilha)), versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome, moeda, percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra), projeto:projetos(id, codigo, nome, cliente_id, data_inicio_prevista, data_fim_prevista, cliente:clientes(id, nome_fantasia))",
      )
      .eq("id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
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
    competenciasRes,
    mesesRes,
    recusasDeSave,
    consumosComPedidoRes,
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
    // `data_pagamento` entrou em 08/09/2026 para a ficha da PP em leitura
    // mostrar quando o financeiro programou cada parcela — é o que a
    // produção pergunta depois do envio.
    supabase
      .from("pedidos_compra")
      .select(
        "*, emitido:profiles!emitida_por(nome), enviado:profiles!enviada_financeiro_por(nome), responsavel:profiles!responsavel_verba_id(nome), anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes), parcelas:pedidos_compra_parcelas(id, tenant_id, pedido_compra_id, numero, data_vencimento, data_pagamento, valor, pdf_path, pago_em, pago_por, created_at, updated_at, created_by), " +
          // Prestação de contas da verba e estorno do saldo (decisão 081).
          SELECT_PRESTACAO_DA_VERBA,
      )
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("fornecedores")
      // `cpf_cnpj` entrou em 09/09/2026: o campo de fornecedor da PP virou
      // um combo com busca, e o documento é o que separa homônimos — a
      // busca olha nome E documento, e a opção mostra os dois.
      .select("id, nome, razao_social, status, cpf_cnpj")
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
    //
    // `percentual_imposto` entrou em 16/09/2026: sem ela o diálogo do BV
    // abria a alíquota salva vazia, o "Confirmar" pedia de novo, e salvar
    // o BV sem redigitar gravava a alíquota como nula.
    supabase
      .from("itens_bv")
      .select(
        "id, tenant_id, item_versao_id, job_item_orcado_id, fornecedor_id, valor, prazo_repasse, " +
          "percentual_imposto, situacao, created_by, created_at, updated_at, " +
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
    // Envios para faturamento: um por job — ou um por MÊS nos jobs do
    // modelo mensal (Fee e Always On, decisão 078). O envio único (sem
    // mês) decide entre mostrar "Enviar para faturamento" e liberar o
    // encerramento; os mensais alimentam a barra de faturamento por mês.
    supabase
      .from("jobs_envio_faturamento")
      .select(
        "id, mes, valor_faturado, valor_save, data_faturamento, numero_po, descricao_nf, portal_url, enviado_em, parcelas:jobs_envio_faturamento_parcelas(id, ordem, valor, data_vencimento)",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("mes", { ascending: true, nullsFirst: true }),
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
      .select("id, codigo, nome, status, faturamento_enviado_em")
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
    // O rateio de competência do job (`jobs_competencias`, decisão 055),
    // para a ficha listar cada trimestre com o seu percentual.
    supabase
      .from("jobs_competencias")
      .select("trimestre, ano, percentual")
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("ano", { ascending: true })
      .order("trimestre", { ascending: true }),
    // Meses da versão aprovada (decisão 078). Só o modelo mensal tem; nos
    // outros a lista vem vazia, e a planilha é a de sempre.
    mesesDaVersaoQuery(supabase, session.activeTenant.id, versaoAprovadaId),
    // As recusas de save viram card na Comunicação (decisão 099).
    lerRecusasDeSaveDoJob(supabase, session.activeTenant.id, raw.id),
    // Situação dos pedidos de CONSUMO das linhas do job: "pago só por save"
    // só vale com o consumo aprovado (decisão 099).
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id, situacao")
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("tipo", "consome")
      .in("situacao", ["aprovado", "aguardando"]),
  ]);

  if (mesesRes.error) console.error("[job.meses]", mesesRes.error.message);
  const meses = mesesRes.data ?? [];

  const grupos = (gruposRes.data ?? []) as VersaoOrcamentoGrupo[];
  if (itensRes.error) console.error("[job.orcado]", itensRes.error.message);
  if (bvsRes.error) console.error("[job.bvs]", bvsRes.error.message);
  if (envioFaturamentoRes.error) {
    console.error("[job.envio-faturamento]", envioFaturamentoRes.error.message);
  }

  const envios: EnvioDoJobComParcelas[] = (
    (envioFaturamentoRes.data ?? []) as any[]
  ).map((e) => ({
    ...e,
    valor_faturado: Number(e.valor_faturado ?? 0),
    valor_save: e.valor_save === null ? null : Number(e.valor_save),
    parcelas: ((e.parcelas ?? []) as any[])
      .map((par) => ({ ...par, valor: Number(par.valor ?? 0) }))
      .sort((a, b) => a.ordem - b.ordem),
  }));
  // O envio único dos jobs que não são mensais — o de sempre.
  const envioFaturamento = envios.find((e) => e.mes === null) ?? null;
  const enviosMensais = envios.filter((e) => e.mes !== null);
  // Só os portais do cliente DESTE job — a consulta traz os do tenant e o
  // filtro por cliente é feito aqui, com o id que já veio no `raw`.
  const portaisDoCliente = ((portaisRes.data ?? []) as any[])
    .filter((p) => p.cliente?.id === raw.projeto?.cliente_id)
    .map((p) => ({ id: p.id, nome: p.nome, url: p.url }));

  // Indexado pela CÓPIA do job: a calha consulta uma chave por linha, e
  // desde 27/08/2026 essa chave é a única que existe em toda linha.
  // Objeto, e não Map, porque só objeto atravessa a fronteira server →
  // client.
  const bvsPorItem: Record<string, ItemBv[]> = {};
  for (const raw of (bvsRes.data ?? []) as any[]) {
    const { copia: _joinFiltro, ...bv } = raw;
    if (!bv.job_item_orcado_id) continue;
    (bvsPorItem[bv.job_item_orcado_id] ??= []).push({
      ...bv,
      valor: Number(bv.valor ?? 0),
    });
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

  // A ORIGEM da PP no job: o realizado aponta pra linha da planilha, que
  // aponta pro grupo. A aba de PPs mostra os dois juntos numa coluna
  // desde 09/09/2026 — o item em negrito, o grupo na etiqueta abaixo.
  const grupoNomePorId = new Map(grupos.map((g) => [g.id, g.nome]));
  const itemPorId = new Map(itens.map((i) => [i.id, i]));
  const grupoPorItemRealizadoId = new Map<string, string>();
  const itemPorItemRealizadoId = new Map<string, string>();
  for (const r of realizados) {
    const item = r.job_item_orcado_id
      ? itemPorId.get(r.job_item_orcado_id)
      : undefined;
    if (!item) continue;
    const nome = grupoNomePorId.get(item.grupo_id);
    if (nome) grupoPorItemRealizadoId.set(r.id, nome);
    if (item.item) itemPorItemRealizadoId.set(r.id, item.item);
  }

  // O asterisco da decisão 067: quais fornecedores mudaram de conta
  // depois que uma PP deles tirou a foto.
  //
  // Uma consulta só, e SÓ dos fornecedores que aparecem nas PPs com foto
  // — quase sempre um punhado. Os dados bancários morrem aqui: o que sai
  // desta função é um booleano por PP, não a conta de ninguém.
  const idsComFoto = Array.from(
    new Set(
      ((ppsRes.data ?? []) as any[])
        .filter((pp) => pp.dados_pagamento_congelados_em && pp.fornecedor_id)
        .map((pp) => pp.fornecedor_id as string),
    ),
  );
  const pagamentoAtualPorFornecedor = new Map<string, DadosDePagamento>();
  if (idsComFoto.length > 0) {
    const { data: cadastros } = await supabase
      .from("fornecedores")
      .select(`id, ${COLUNAS_DE_PAGAMENTO}`)
      .eq("tenant_id", session.activeTenant.id)
      .in("id", idsComFoto);
    for (const f of (cadastros ?? []) as any[]) {
      pagamentoAtualPorFornecedor.set(f.id as string, f as DadosDePagamento);
    }
  }

  const ppsDoJob: PedidoCompraNaLista[] = (ppsRes.data ?? []).map((pp: any) => ({
    ...pp,
    // numeric do Postgres chega como string: sem o Number, o formulário
    // de correção abriria com "1.000" no D/M e "2500.00" no unitário.
    valor_unitario: Number(pp.valor_unitario ?? 0),
    quantidade: Number(pp.quantidade),
    dias_meses: Number(pp.dias_meses ?? 0),
    valor: Number(pp.valor),
    emitida_por_nome: pp.emitido?.nome ?? null,
    enviada_financeiro_por_nome: pp.enviado?.nome ?? null,
    item_nome: itemPorItemRealizadoId.get(pp.item_realizado_id) ?? null,
    grupo_nome: grupoPorItemRealizadoId.get(pp.item_realizado_id) ?? null,
    parcelas: (pp.parcelas ?? [])
      .map((p: any) => ({ ...p, valor: Number(p.valor ?? 0) }))
      .sort((a: any, b: any) => a.numero - b.numero),
    anexos: (pp.anexos ?? []).map((a: any) => ({
      id: a.id,
      arquivo_nome_original: a.arquivo_nome_original,
      arquivo_tamanho_bytes: Number(a.arquivo_tamanho_bytes ?? 0),
    })),
    prestacao: prestacaoDaVerba(pp.prestacao),
    devolucao: devolucaoDaVerba(pp.devolucao),
    cadastro_do_fornecedor_mudou: cadastroMudouDepoisDaFoto(
      pp,
      pp.fornecedor_id
        ? (pagamentoAtualPorFornecedor.get(pp.fornecedor_id) ?? null)
        : null,
    ),
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
    // Obrigatórios, nunca opcionais: tipo de linha estreito com campo
    // opcional é como campo novo do servidor some calado (CLAUDE.md).
    percentual_int_taxes: number;
    int_transaction_costs: number;
    moeda_estrangeira: string | null;
    cambio_compra: number | null;
  };

  // Qual fechamento este job usa. Sai da categoria do ORÇAMENTO que o
  // originou, nunca da do job (decisão 072): a do job classifica para o
  // financeiro, e mexer nela não pode mover um `valor_job_abertura` que
  // está congelado.
  const planilha = configDaPlanilha(
    (raw.orcamento as { categoria?: { modelo_planilha?: string } } | null)
      ?.categoria?.modelo_planilha as CategoriaModeloPlanilha | undefined,
    versaoAprovada,
  );

  const transicoes = JOB_STATUS_TRANSICOES[raw.status as JobStatus];

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome" | "empresa_id">[];

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
    encerrado_em: raw.encerrado_em ?? null,
    encerrado_por: raw.encerrado_por ?? null,
    finalizado_em: raw.finalizado_em ?? null,
    faturamento_enviado_em: raw.faturamento_enviado_em ?? null,
    motivo_rejeicao: raw.motivo_rejeicao ?? null,
    // Registro financeiro da abertura. A página de Jobs não exibe estes
    // campos, mas a tela do job no financeiro exibe — e o formulário de
    // abertura em leitura decide pela curva de desembolso a partir de
    // `custo_previsto_total`. Sem eles no select, o job aparecia lá como
    // "sem desembolso previsto" mesmo tendo curva gravada.
    nome_financeiro: raw.nome_financeiro ?? null,
    categoria_id: raw.categoria_id ?? null,
    servico_id: raw.servico_id ?? null,
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
    planilha.internacional,
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
        bvsPorItem[it.id] ?? [],
        Number(realizadosMap.get(it.id)?.total_realizado ?? 0),
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
    recusasDeSave,
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
    ).length +
    recusasDeSaveNaoLidas(recusasDeSave, session.profile.id, lidaAte);

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

  // Envio para faturamento: quem produz e quem libera, porque PO, CNAE e
  // portal sao informacao da producao. So Admin e Gerente de Producao
  // podem enviar/aprovar (matriz `jobs.enviar_faturamento`); os demais
  // papeis nao veem o botao.
  //
  // Fee e Always On (modelo mensal, decisão 078) faturam mês a mês: o
  // envio único não vale para eles, e a action também recusa.
  //
  // O job encerrado ainda não faturado continua enviando (decisão 087):
  // faturamento e encerramento correm separados desde 16/09/2026.
  const podeEnviarFaturamento =
    pode(session.activeRole, "jobs.enviar_faturamento") &&
    jobAceitaEnvioParaFaturamento(job.status) &&
    envioFaturamento === null &&
    totaisJob.faturamentoPrevisto > 0 &&
    planilha.modeloPlanilha !== "mensal";
  // O envio de cada mês (modelo mensal): mesma matriz e job aberto. Qual
  // mês pode ir sai da barra, pela situação de cada um.
  const podeEnviarFaturamentoMensal =
    pode(session.activeRole, "jobs.enviar_faturamento") &&
    jobAceitaEnvioParaFaturamento(job.status) &&
    planilha.modeloPlanilha === "mensal";

  // Job pago INTEIRAMENTE por saldo de save: faturamento previsto zero e
  // consumo registrado. Ele pula a etapa de faturamento e se comporta
  // como já faturado — a nota dele saiu no job que gerou o crédito
  // (decisão do Tiago em 27/08/2026, decisão 028 §11). Sem isto ele
  // travava dos dois lados: não dá para enviar (valor zero) e o
  // encerramento só aparecia depois do envio.
  //
  // A condição é DUPLA só para escolher a FRASE da trilha: o job zerado
  // sem save — todo em F · Interno, ou só com custo que o cliente paga
  // direto — também não tem faturamento e também finaliza só com o
  // encerramento (`jobs_finaliza_ao_encerrar`, decisão 105); a trilha dele
  // diz "não há nota a emitir". Mesma régua de
  // `lib/data/faturamento-por-job.ts`.
  const saveConsumidoNoJob = itens.reduce(
    (soma, it) => soma + Number(it.save_consumido ?? 0),
    0,
  );
  // E só com o consumo APROVADO (decisão 099): consumo que aguarda o
  // financeiro pode ser recusado, e aí o faturamento volta a existir. Mesma
  // régua de `lib/data/faturamento-por-job.ts`.
  if (consumosComPedidoRes.error)
    console.error("[job.consumos_pedido]", consumosComPedidoRes.error.message);
  const pedidosDeConsumo = (consumosComPedidoRes.data ?? []) as {
    job_item_orcado_id: string | null;
    situacao: string;
  }[];
  const consumoTodoAprovado = itens
    .filter((it) => Number(it.save_consumido ?? 0) > 0)
    .every(
      (it) =>
        pedidosDeConsumo.some(
          (p) => p.job_item_orcado_id === it.orcado_id && p.situacao === "aprovado",
        ) &&
        !pedidosDeConsumo.some(
          (p) => p.job_item_orcado_id === it.orcado_id && p.situacao === "aguardando",
        ),
    );
  const pagoSoPorSave =
    totaisJob.faturamentoPrevisto <= 0.004 &&
    saveConsumidoNoJob > 0 &&
    !consumosComPedidoRes.error &&
    consumoTodoAprovado;

  if (jobsIrmaosRes.error)
    console.error("[job.irmaos]", jobsIrmaosRes.error.message);

  const jobsDoProjeto = ((jobsIrmaosRes.data ?? []) as any[]).map((j) => ({
    id: j.id as string,
    codigo: j.codigo as string,
    nome: j.nome as string,
    // Só vira selo: "Em faturamento" é o aberto com o envio completo (094).
    status: jobStatusExibido(
      j.status as JobStatus,
      (j.faturamento_enviado_em as string | null) ?? null,
    ),
  }));

  const abertoPorNome =
    (abertoPorRes.data as { nome: string } | null)?.nome ?? null;

  if (competenciasRes.error) {
    console.error("[job.competencias]", competenciasRes.error.message);
  }
  const competencias: JobCompetencia[] = (
    (competenciasRes.data ?? []) as any[]
  ).map((c) => ({
    trimestre: Number(c.trimestre),
    ano: Number(c.ano),
    percentual: Number(c.percentual ?? 0),
  }));

  const versaoLabel = raw.versao
    ? nomeVersao(raw.orcamento?.nome ?? job.nome, raw.versao.numero_versao)
    : "—";

  // Saldo a faturar: as parcelas do envio que ainda não viraram nota
  // emitida. Desde 16/09/2026 (decisão 087) ele NÃO trava o encerramento —
  // aparece no fechamento como aviso, e o job encerrado continua na fila de
  // faturamento. Só é lido quando existe envio: sem envio não há parcela.
  const saldoAFaturar =
    envios.length > 0
      ? await saldoAFaturarDoJob(session.activeTenant.id, jobId)
      : 0;

  // As notas emitidas sobre as parcelas de TODOS os envios — do mensal, por
  // mês, e do envio único do job normal, que ganhou o mesmo "Ver envio" na
  // decisão 087. Uma leitura só, e só quando há envio.
  const idsParcelas = envios.flatMap((e) => e.parcelas.map((par) => par.id));
  const notasDasParcelasRes =
    idsParcelas.length > 0
      ? await supabase
          .from("faturamento_itens")
          .select(
            "envio_parcela_id, valor, faturamento:faturamentos!inner(numero_nf, data_emissao, status)",
          )
          .eq("tenant_id", session.activeTenant.id)
          .eq("faturamento.status", "emitido")
          .in("envio_parcela_id", idsParcelas)
      : { data: [], error: null };
  if (notasDasParcelasRes.error) {
    console.error("[job.notas-das-parcelas]", notasDasParcelasRes.error.message);
  }
  const faturamentoMensal: MesDeFaturamento[] =
    planilha.modeloPlanilha === "mensal"
      ? montarFaturamentoMensal({
          meses,
          grupos,
          itens,
          percentualHonorarios: Number(versaoAprovada.percentual_honorarios),
          percentualImposto: Number(versaoAprovada.percentual_imposto),
          envios: enviosMensais,
          itensDeNota: (notasDasParcelasRes.data ?? []) as unknown as ItemDeNotaDaParcela[],
        })
      : [];
  const todosOsMesesEnviados =
    faturamentoMensal.length > 0 &&
    faturamentoMensal.every((m) => m.envio !== null || m.situacao === "sem_faturamento");

  // O faturamento do job que não é mensal: o envio único, as notas e a
  // situação — a trilha "Faturamento" da barra e o "Ver envio" (decisão 087).
  const faturamentoEnvioUnico: FaturamentoDoEnvioUnico | null =
    planilha.modeloPlanilha === "mensal"
      ? null
      : montarFaturamentoDoEnvioUnico({
          envio: envioFaturamento,
          itensDeNota: (notasDasParcelasRes.data ?? []) as unknown as ItemDeNotaDaParcela[],
          semFaturamento: totaisJob.faturamentoPrevisto <= 0.004,
        });

  // Todo o faturamento do job já saiu em nota. ⚠️ Desde 20/09/2026 (decisão
  // 094) isto NÃO decide mais o status: o `finalizado` vale pelo envio
  // (`jobs.faturamento_enviado_em`). Fica para o "Aguardando encerramento"
  // do cabeçalho do job no financeiro, que é quem controla a nota.
  const faturamentoCompleto =
    planilha.modeloPlanilha === "mensal"
      ? todosOsMesesEnviados && saldoAFaturar <= 0.01
      : faturamentoEnvioUnico !== null &&
        (faturamentoEnvioUnico.situacao === "sem_faturamento" ||
          (envioFaturamento !== null && saldoAFaturar <= 0.01));

  const ppsEmAberto = ppsDoJob
    .filter((pp) => PP_STATUS_EM_ABERTO.includes(pp.status))
    .map((pp) => ({ codigo: pp.codigo, status: pp.status }));
  // Verba paga sem prestação aprovada — por enviar, em avaliação ou
  // reprovada — também trava (decisão 081, pergunta 10a; o estorno por
  // baixar deixou de travar em 22/09/2026). A verba ainda sem baixa já está
  // em `ppsEmAberto`.
  const verbasEmAberto = ppsDoJob.flatMap((pp) => {
    const situacao = situacaoDaVerba(pp);
    return verbaPendenteNoEncerramento(situacao) ? [{ codigo: pp.codigo, situacao }] : [];
  });
  const nomeDoItem = new Map(itens.map((it) => [it.id, it.item]));
  // Um item pode ter vários BVs (decisão 062): cada um em aberto vira uma
  // pendência própria no diálogo de encerramento, com o nome do item
  // repetido — é o BV que trava, não o item.
  const bvsEmAberto = Object.entries(bvsPorItem).flatMap(([orcadoId, bvs]) =>
    bvs
      .filter((bv) => BV_SITUACAO_EM_ABERTO.includes(bv.situacao))
      .map((bv) => ({
        item: nomeDoItem.get(orcadoId) ?? "Item da planilha",
        situacao: bv.situacao,
      })),
  );

  // Itens de custo que ainda não disseram se sai mais PP (decisão 052).
  // Sai dos dados já carregados: a linha da planilha diz o tipo, e a
  // âncora do realizado guarda o marco. A e D ficam de fora — eles pagam
  // por BV e não têm o que marcar.
  const itensSemMarcacao = itens
    .filter(
      (it) =>
        // Mesmo recorte da trava do encerramento e do botão "Concluir
        // PPs" — aqui em memória, porque a página já carregou tudo.
        itemPrecisaDeConclusao(it.tipo_custo, it.em_save === true) &&
        realizadosMap.get(it.id)?.pps_concluidas_em == null,
    )
    .map((it) => ({ item: it.item }));

  // O fechamento do job (decisão 087): o que ainda trava o envio para
  // encerramento, o que falta faturar (aviso, não trava) e, depois de
  // encerrado, quem enviou e quando. Existe para todo job que já passou pela
  // abertura — o encerramento não espera mais o envio para faturamento.
  const fechamento: FechamentoDoJob | null =
    job.status === "aberto" ||
    job.status === "em_producao" ||
    job.status === "encerrado" ||
    job.status === "finalizado"
      ? {
          ppsEmAberto,
          verbasEmAberto,
          bvsEmAberto,
          itensSemMarcacao,
          semEnvio:
            planilha.modeloPlanilha !== "mensal" &&
            envioFaturamento === null &&
            faturamentoEnvioUnico?.situacao !== "sem_faturamento",
          mesesSemEnvio: faturamentoMensal
            .filter((m) => m.situacao === "a_enviar")
            .map((m) => nomeDoMes(m.mes)),
          // O carimbo é do banco (decisão 094). Job sem faturamento previsto
          // nunca é carimbado, mas finaliza direto no encerramento.
          faturamentoTodoEnviado:
            job.faturamento_enviado_em !== null ||
            totaisJob.faturamentoPrevisto <= 0.004,
          encerradoEm: job.encerrado_em,
          encerradoPorNome:
            (raw.encerrado_por_perfil as { nome: string } | null)?.nome ?? null,
          finalizadoEm: job.finalizado_em,
        }
      : null;

  // Mesmo perfil de permissao nos dois flags — o que muda e o status.
  // O realizado passou a valer antes da abertura (17/08/2026); errata,
  // BV e PP continuam presos ao job ja aberto pelo financeiro. As duas
  // regras moram em `lib/types.ts`, que e de onde as server actions leem.
  //
  // Dupla barreira desde 03/09/2026 (Task 3 do projeto de permissoes):
  // (a) o PAPEL precisa poder editar job — barra Financeiro/Freelancer
  //     antes de entrar na regra operacional;
  // (b) dentro dos papeis que podem, seguimos com a regra "admin OU
  //     responsavel do job", que protege operacionalmente contra GP/PROD
  //     mexerem em job alheio.
  const quemPodeMexer =
    pode(session.activeRole, "jobs.editar") &&
    (session.activeRole === "administrador" ||
      job.responsavel_id === session.profile.id);

  const podeEditarRealizado = quemPodeMexer && jobAceitaRealizado(job.status);
  const podeAcoesPlanilha = quemPodeMexer && jobAceitaAcoesPlanilha(job.status);
  // A PP se partiu em dois desde 08/09/2026 (decisão 056): GERAR vale na
  // pré-abertura, ENVIAR ao financeiro continua esperando a abertura — e
  // a marca `abertura_em_revisao` fecha o envio sem mexer no status
  // (decisão 040). Errata e BV seguem em `podeAcoesPlanilha`.
  const podeGerarPP = quemPodeMexer && jobAceitaGerarPP(job.status);
  /**
   * O "+" e o lápis do campo Fornecedor da PP são DUAS permissões, e não
   * uma (18/09/2026):
   *
   *  * criar pelo drawer é `cadastros.fornecedores.inline` — o gate mais
   *    largo da decisão 048, que existe justamente para o GP e o produtor
   *    cadastrarem sem sair da PP;
   *  * abrir o cadastro para editar é `cadastros.fornecedores.editar`,
   *    que é só do administrador.
   *
   * A action barra dos dois lados de qualquer jeito. Aqui é para a pessoa
   * não preencher o cadastro inteiro e só então ler "Você não tem
   * permissão para essa ação".
   */
  const podeCadastrarFornecedor = pode(
    session.activeRole,
    "cadastros.fornecedores.inline",
  );
  const podeEditarFornecedor = pode(
    session.activeRole,
    "cadastros.fornecedores.editar",
  );
  // Quem presta contas de cada verba (decisão 081, pergunta 6a): o
  // responsável por ela, o responsável do job ou um administrador. A função
  // do banco checa de novo; aqui é só para mostrar o botão a quem pode.
  const ppsQuePossoPrestarContas = ppsDoJob
    .filter(
      (pp) =>
        pp.verba_producao &&
        (session.activeRole === "administrador" ||
          pp.responsavel_verba_id === session.profile.id ||
          job.responsavel_id === session.profile.id),
    )
    .map((pp) => pp.id);
  // Confirmar o BV é do GP e do administrador (decisão 080). Lançar e
  // negociar seguem em `podeAcoesPlanilha`, para quem pode mexer no job.
  const podeConfirmarBv =
    podeAcoesPlanilha && pode(session.activeRole, "jobs.confirmar_bv");
  const podeEnviarPP =
    quemPodeMexer &&
    jobAceitaEnvioDePP(job.status) &&
    job.abertura_em_revisao !== true;
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
    podeEnviarFaturamentoMensal,
    pagoSoPorSave,
    // Serviço Interno (decisão 105): lido do ORÇAMENTO, que é quem decide a
    // planilha — o financeiro não troca o job para dentro ou para fora dele
    // (`job_servico_e_categoria_seguem_a_planilha`).
    interno:
      (raw.orcamento as { servico?: { investimento_interno?: boolean } | null } | null)
        ?.servico?.investimento_interno === true,
    portaisDoCliente,
    jobsDoProjeto,
    abertoPorNome,
    competencias,
    // Qual fechamento este job usa — as telas que montam `versao` à mão
    // precisam dele para o card de Totais e para a barra de errata
    // (decisão 072).
    modeloPlanilha: planilha.modeloPlanilha,
    meses,
    envios,
    faturamentoMensal,
    totaisJob,
    custoPlanejadoJob,
    custoRealizadoJob,
    bvPlanejadoJob,
    bvRealizadoJob,
    fechamento,
    // Quem pode enviar para encerramento (matriz `jobs.encerrar`). O
    // servidor confere de novo em `encerrarJob`.
    podeEncerrar: pode(session.activeRole, "jobs.encerrar"),
    // Exportar a planilha interna do job (decisão 088): quem vê a tela
    // exporta. O freelancer, que só tem `jobs.ver_restrito`, fica de fora,
    // e a rota confere de novo.
    podeExportarInterna: pode(session.activeRole, "jobs.ver"),
    faturamentoEnvioUnico,
    faturamentoCompleto,
    internacional: planilha.internacional,
    moedaEstrangeira: planilha.moedaEstrangeira,
    podeEditarRealizado,
    podeAcoesPlanilha,
    // Save (decisão 099, revista em 24/09/2026): gerar, consumir, retirar e
    // cancelar pedido é do administrador ou de QUALQUER GP — não segue a
    // regra "admin ou responsável" de errata e PP, e o produtor fica de
    // fora. O banco confere de novo (`save_pode_mexer_no_job`).
    podeMexerNoSave: pode(session.activeRole, "jobs.consumir_save"),
    podeGerarPP,
    podeCadastrarFornecedor,
    podeEditarFornecedor,
    podeEnviarPP,
    podeConfirmarBv,
    ppsQuePossoPrestarContas,
  };
}
