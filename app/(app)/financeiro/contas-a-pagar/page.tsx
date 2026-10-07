import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { listarConversasPPs } from "@/lib/data/chat-pps-conversas";
import { COLUNAS_DE_PAGAMENTO } from "@/lib/data/foto-pagamento-da-pp";
import { carregarFiscalDaAprovacaoPP } from "@/lib/fiscal/aprovacao-da-pp";
import { montarRetencaoDaAprovacao } from "@/lib/fiscal/retencao-da-aprovacao";
import { aliquotasDaParcela, retencoesPelaAprovacao } from "@/lib/financeiro/baixa-em-lote";
import { ChatPPsProvider } from "./chat/chat-pps-provider";
import { PedidosCompraList, type PPRow } from "./pedidos-compra-list";
import { ContasPagarTabs } from "./contas-pagar-tabs";
import { lerTab } from "./contas-pagar-tab-url";
import { TitulosPagarList } from "./titulos-pagar-list";
import {
  ORIGENS_DA_BAIXA_A_PAGAR,
  ORIGENS_DO_ESTORNO_A_PAGAR,
  SELECT_AVULSA_A_PAGAR,
  SELECT_BAIXA_A_PAGAR,
  SELECT_DESEMBOLSO_DO_TITULO,
  SELECT_DEVOLUCAO_DE_VERBA,
  SELECT_FATURA_DO_TITULO,
  SELECT_ITEM_EM_REMESSA,
  SELECT_PP_DO_FINANCEIRO,
  mapearPPsDoFinanceiro,
  montarTitulosAPagar,
} from "./dados-dos-titulos";
import { SELECT_ESTORNO_DE_BAIXA } from "@/lib/data/estornos-de-baixa";
import { mapearUltimasRetencoes } from "@/lib/data/baixas-do-documento";
import { CartaoTab, type CartaoDaCapa, type FaturaTela } from "./cartao-tab";
import {
  carregarExtratoDaFatura,
  type StatusFatura,
} from "@/lib/data/fatura-cartao-extrato";
import {
  chaveCompetencia,
  competenciaAtual,
  competenciaDaData,
  lerCompetencia,
} from "@/lib/cartoes/competencia";
import type { FaturaDoCartao } from "./fechar-fatura-dialog";
import { RecorrentesList, type RecorrenteRow } from "./recorrentes-list";
import { DesembolsosContasPagarList, type DesembolsoRow } from "./desembolsos-list";
import { FolhasPagarList, type FolhaLinhaFinanceiro } from "./folhas-pagar-list";
import {
  carregarColaboradoresPagamento,
  temConta,
  temPix,
} from "@/lib/financeiro/colaboradores-pagamento";
import {
  ExportarRemessaCnabDialog,
  type ContaSantanderElegivel,
  type TituloElegivelParaRemessa,
} from "./remessa-cnab-dialog";
import type {
  PlanoContaTipo,
  PlanoContaSubtipo,
  ContaBancaria,
  BandeiraCartao,
  DesembolsoStatus,
  PagamentoForaDoCadastroDaPP,
  PixTipoChave,
  TipoContaBancariaFornecedor,
} from "@/lib/types";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

// TODO: filtro=pps_em_avaliacao — join com pedidos_compra ainda nao implementado
// TODO: filtro=faturas_cartao — precisa distinguir origem; implementar em fase 2

export default async function PedidosCompraFinanceiroPage({
  searchParams,
}: {
  searchParams?: {
    filtro?: string;
    empresa?: string;
    /** Aba Cartão (decisão 093, entrega 2): `tab=cartao`, o cartão e a
     *  competência `AAAA-MM` da fatura em tela. */
    tab?: string;
    cartao?: string;
    competencia?: string;
  };
}) {
  const session = await requireSession();

  const empresaFiltroIds: string[] =
    typeof searchParams?.empresa === "string" && searchParams.empresa.length > 0
      ? searchParams.empresa.split(",").filter((id) => id.length > 0)
      : session.activeEmpresas.map((e) => e.id);

  const activeEmpresasEfetivas =
    empresaFiltroIds.length > 0
      ? session.empresas.filter((e) => empresaFiltroIds.includes(e.id))
      : [];

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  // A aba Cartão com um cartão escolhido (decisão 093, entrega 2). O id é
  // conferido antes de entrar na consulta: `?cartao=qualquer-coisa` faria
  // o PostgREST recusar a query, e a tela abriria vazia sem dizer por quê.
  // Vale com qualquer `?tab=`: ao sair da aba Cartão os parâmetros ficam
  // na URL (093 §13), e um recarregamento devolve a fatura que estava
  // aberta. A consulta do extrato só roda quando eles existem.
  const cartaoSelId =
    searchParams?.cartao &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      searchParams.cartao,
    )
      ? searchParams.cartao
      : null;

  const [
    { data, error },
    contasRes,
    tiposRes,
    subtiposRes,
    ppsPendentesCountRes,
    avulsasRes,
    baixasRes,
    estornosRes,
    empresasRes,
    fornecedoresRes,
    clientesRes,
    recorrentesRes,
    recorrentesAtivasCountRes,
    regionaisRes,
    cartoesRes,
    desembolsosRes,
    desembolsosTitulosRes,
    devolucoesRes,
    conversasChatPPs,
    folhasRes,
    faturasDoCartaoSelRes,
    cnabAPagarRes,
    cnabColaboradoresRes,
    remessasItensRes,
    ultimasRetencoesRes,
    retencoesDaAprovacaoRes,
  ] = await Promise.all([
    (() => {
      let q = supabase
        .from("pedidos_compra")
        .select(SELECT_PP_DO_FINANCEIRO)
        .eq("tenant_id", session.activeTenant.id)
        // PP gerada ainda está no job, sem envio: o financeiro não a vê —
        // nem no chip "Todas" (02/09/2026, decisão 039).
        .neq("status", "gerada")
        // Nem a cancelada que nunca foi enviada (decisão 113): cancelar
        // tira a PP de `gerada`, e até 28/09/2026 ela aparecia em
        // "Canceladas". Cobre também a PP de job não aberto, que não pode
        // ser enviada.
        .not("enviada_financeiro_em", "is", null);
      if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
      return q.order("created_at", { ascending: false });
    })(),
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .neq("tipo", "cartao_credito")
      .returns<ContaBancaria[]>(),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaSubtipo[]>(),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "em_avaliacao"),
    // Contas avulsas (todos os status) — viram títulos de origem AVULSO ou
    // RECORRÊNCIA na aba unificada, conforme `recorrente_id`.
    (() => {
      const hoje = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from("contas_avulsas")
        .select(SELECT_AVULSA_A_PAGAR)
        .eq("tenant_id", session.activeTenant.id)
        // Recebimento avulso e rendimento também são contas avulsas, mas
        // são de Títulos a Receber (decisão 124).
        .is("tipo_entrada", null)
        .order("data_prevista_pagamento", { ascending: true })
        .order("created_at", { ascending: false });
      // Filtro de aterrissagem: vencidas = data prevista passada e ainda não baixadas
      if (searchParams?.filtro === "vencidas") {
        q = q
          .lt("data_prevista_pagamento", hoje)
          .neq("status", "baixada");
      }
      if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
      return q;
    })(),
    // As baixas registradas (decisão 125: parcela de PP e avulsa podem ter
    // várias), com conta, centro de custo e impostos retidos — o popup do
    // olho e o "falta R$ X" da linha. Da mais antiga para a mais nova: a
    // última de cada documento é a que a linha paga mostra.
    supabase
      .from("lancamentos_financeiros")
      .select(SELECT_BAIXA_A_PAGAR)
      .eq("tenant_id", session.activeTenant.id)
      .in("origem", ORIGENS_DA_BAIXA_A_PAGAR)
      .order("data_movimento", { ascending: true })
      .order("created_at", { ascending: true }),
    // Estornos das baixas (decisão 120): o popup do olho lista, e a linha
    // mostra "estornado R$ X".
    supabase
      .from("lancamentos_financeiros")
      .select(SELECT_ESTORNO_DE_BAIXA)
      .eq("tenant_id", session.activeTenant.id)
      .in("origem", ORIGENS_DO_ESTORNO_A_PAGAR)
      .not("estorno_de_lancamento_id", "is", null),
    // Empresas ativas (dropdown do drawer)
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social"),
    // Fornecedores ativos (dropdown)
    supabase
      .from("fornecedores")
      // Os nove campos de pagamento entram para o asterisco da decisão
      // 067 (comparar a foto da PP com o cadastro de hoje) e, desde a
      // decisão 137, para a coluna "Dados de pagamento" da remessa — o
      // único lugar em que chave e conta vão ao cliente.
      .select(`id, nome, razao_social, cpf_cnpj, ${COLUNAS_DE_PAGAMENTO}`)
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    // Clientes ativos (dropdown)
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    // Recorrências (todos os status)
    (async () => {
      let q = supabase
        .from("contas_avulsas_recorrentes")
        .select(`
          id, descricao, valor, frequencia,
          dia_do_mes, dia_quinzena_1, dia_quinzena_2, dia_do_ano_dia, dia_do_ano_mes,
          proxima_data, data_fim, ativo,
          fornecedor:fornecedores(nome, razao_social),
          empresa:empresas(razao_social, nome_fantasia),
          tipo:plano_contas_tipos!inner(codigo),
          subtipo:plano_contas_subtipos!inner(nome)
        `)
        .eq("tenant_id", session.activeTenant.id)
        .order("ativo", { ascending: false })
        .order("proxima_data", { ascending: true });
      if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
      return q;
    })(),
    // Contagem de recorrências ativas
    (async () => {
      let q = supabase
        .from("contas_avulsas_recorrentes")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", session.activeTenant.id)
        .eq("ativo", true);
      if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
      return q;
    })(),
    // Regionais (para o editor de rateio no drawer da avulsa)
    supabase
      .from("regionais")
      .select("id, nome, ativo, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome"),
    // Cartões de crédito ativos (para o drawer de conta avulsa e Task 10)
    supabase
      .from("cartoes_credito")
      .select("id, nome, banco, bandeira, ultimos_4_digitos, dia_vencimento_fatura, dia_fechamento_fatura")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    // Desembolsos — todos os status para a aba de aprovação (Task 9).
    // Task 10 adiciona SELECT diferente com parcelas embed (apenas aprovada/pago).
    (() => {
      let q = supabase
        .from("desembolsos")
        .select(`
        id, codigo, descricao, valor, status,
        data_prevista_pagamento, motivo_rejeicao, motivo_cancelamento,
        aprovada_em, rejeitada_em, cancelada_em, pago_em, created_at,
        empresa:empresas(id, razao_social, nome_fantasia),
        fornecedor:fornecedores(id, nome, razao_social),
        criador:profiles!desembolsos_criado_por_fkey(nome)
      `)
        .eq("tenant_id", session.activeTenant.id);
      if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
      return q.order("created_at", { ascending: false });
    })(),
    // Desembolsos para Títulos a Pagar — apenas aprovada|pago, com parcelas
    // embed. Query separada da de aprovação (Task 9) para não misturar filtros.
    (() => {
      let q = supabase
        .from("desembolsos")
        .select(SELECT_DESEMBOLSO_DO_TITULO)
        .eq("tenant_id", session.activeTenant.id)
        .in("status", ["aprovada", "pago"]);
      if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
      return q.order("created_at", { ascending: false });
    })(),
    // Devoluções de verba de produção — todas (a_pagar + pagas), para a
    // aba Títulos a Pagar (Task 11). Fetch direto na tabela, sem view.
    supabase
      .from("pp_verba_devolucoes")
      .select(SELECT_DEVOLUCAO_DE_VERBA)
      .eq("tenant_id", session.activeTenant.id),
    // Caixa de entrada do chat de PPs (decisão 058): uma linha por job que
    // já mandou PP ao financeiro, com a última mensagem e as não lidas.
    // Entra no mesmo `Promise.all` de propósito — em série ela somaria
    // dois round-trips ao carregamento da tela mais pesada do sistema.
    listarConversasPPs(supabase, session.activeTenant.id),
    // Folhas de pagamento: só as que precisam da atenção do financeiro
    // (enviada + pendente_correcao). Aprovadas já viraram contas_avulsas
    // e aparecem em Títulos a Pagar. O colaborador vem do RPC abaixo
    // (decisão 132): o embed em `colaboradores` volta nulo para o papel
    // financeiro, que não passa na RLS da tabela.
    supabase
      .from("folhas_pagamento")
      .select(
        "id, competencia_ano, competencia_mes, salario_base, status, motivo_pendencia, colaborador_id, alocacoes:folhas_pagamento_alocacoes(id, empresa_id, regional_id, percentual, empresa:empresas(nome_fantasia), regional:regionais(nome))",
      )
      .eq("tenant_id", session.activeTenant.id)
      .in("status", ["enviada", "pendente_correcao"])
      .order("competencia_ano", { ascending: false })
      .order("competencia_mes", { ascending: false }),
    // Aba Cartão com cartão escolhido: TODAS as faturas dele, de qualquer
    // status, para o calendário e as setas de competência. Fora dela, a
    // consulta nem sai.
    cartaoSelId
      ? supabase
          .from("faturas_cartao")
          .select("id, codigo, competencia_fechamento, data_vencimento, status, valor_cobrado")
          .eq("tenant_id", session.activeTenant.id)
          .eq("cartao_credito_id", cartaoSelId)
          .order("competencia_fechamento", { ascending: true })
      : Promise.resolve({ data: null, error: null }),
    // CNAB: títulos a pagar (saída) via vw_a_pagar — pra o Dialog de remessa.
    supabase
      .from("vw_a_pagar")
      .select("origem_tipo, origem_id, descricao, valor, fornecedor_id, colaborador_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("natureza", "saida"),
    // Colaboradores como o financeiro enxerga (decisão 132): nome,
    // contratação e pagamento, pelo RPC — serve à aba de folha e ao
    // diálogo da remessa. Inclui inativos: a última folha de quem saiu
    // também se paga.
    carregarColaboradoresPagamento(supabase, session.activeTenant.id),
    // O que já foi para uma remessa CNAB: só aceita a baixa do que falta,
    // sem retenção (interino da D15, decisão 125). Tabela pequena.
    supabase
      .from("cnab_remessas_itens")
      // Remessa cancelada não trava mais o título (01/10/2026, como a
      // `_documento_em_remessa` do banco).
      .select(SELECT_ITEM_EM_REMESSA)
      .eq("tenant_id", session.activeTenant.id)
      .neq("remessa.status", "cancelado"),
    // As alíquotas da última retenção de cada fornecedor, para o "Repetir
    // as alíquotas" da baixa (decisão 125, D6 2a).
    supabase
      .from("vw_retencao_mais_recente")
      .select("natureza, parte_id, referencia, data_movimento, aliquotas")
      .eq("tenant_id", session.activeTenant.id)
      .eq("natureza", "saida"),
    // As retenções da aprovação das PPs (decisão 145): o diálogo da remessa
    // mostra o líquido que o arquivo paga. Tabela pequena.
    supabase
      .from("pedidos_compra_retencoes")
      .select("pedido_compra_id, imposto, aliquota")
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (error) console.error("[financeiro.pp.list]", error.message);
  if (avulsasRes.error) console.error("[financeiro.avulsas.list]", avulsasRes.error.message);
  if (baixasRes.error) console.error("[financeiro.baixas.list]", baixasRes.error.message);
  if (remessasItensRes.error) console.error("[financeiro.remessas_itens]", remessasItensRes.error.message);
  if (ultimasRetencoesRes.error) console.error("[financeiro.ultimas_retencoes]", ultimasRetencoesRes.error.message);
  if (retencoesDaAprovacaoRes.error) console.error("[financeiro.retencoes_da_aprovacao]", retencoesDaAprovacaoRes.error.message);
  if (recorrentesRes.error) console.error("[financeiro.recorrentes.list]", recorrentesRes.error.message);
  if (cartoesRes.error) console.error("[financeiro.cartoes.list]", cartoesRes.error.message);
  if (desembolsosRes.error) console.error("[financeiro.desembolsos.list]", desembolsosRes.error.message);
  if (desembolsosTitulosRes.error) console.error("[financeiro.desembolsos_titulos.list]", desembolsosTitulosRes.error.message);
  if (devolucoesRes.error) console.error("[financeiro.devolucoes.list]", devolucoesRes.error.message);


  // As PPs na forma da tela. O mapeamento (com o asterisco da decisão 067)
  // mora em `dados-dos-titulos.ts` desde 02/10/2026, junto com a montagem
  // dos títulos, que parte dele.
  const rows: PPRow[] = mapearPPsDoFinanceiro(data, fornecedoresRes.data);

  // As PPs em avaliação com NF anexada abrem as seções novas da aprovação
  // (módulo fiscal). O que elas leem — cadastro de impostos e última
  // retenção do fornecedor — sai agora e corre junto das leituras do
  // cartão abaixo; a página só espera no fim.
  const fiscalDaAprovacaoPromise = carregarFiscalDaAprovacaoPP(
    supabase,
    session.activeTenant.id,
    rows.filter((r) => r.status === "em_avaliacao" && r.notas_fiscais !== null),
  );

  // As alíquotas da última retenção de cada fornecedor, para o "Repetir
  // as alíquotas" da baixa (decisão 125, D6 2a).
  const ultimasRetencoes = mapearUltimasRetencoes(ultimasRetencoesRes.data);

  // ---- Faturas ABERTAS, para o fechamento na aba Cartão ----
  //
  // A soma vem dos ITENS que apontam para a fatura, e não de uma coluna
  // guardada: enquanto a fatura está aberta o time ainda lança e remaneja,
  // e um total gravado envelheceria a cada mexida.
  const { data: faturasAbertasRes } = await supabase
    .from("faturas_cartao")
    .select(
      "id, codigo, cartao_credito_id, competencia_fechamento, data_vencimento, " +
        "status, valor_cobrado, itens:contas_avulsas(valor, status, natureza), " +
        // A empresa do cartão decide quais regionais podem ratear o ajuste
        // do fechamento (decisão 084).
        "cartao:cartoes_credito!inner(empresa_id), " +
        // A fatura tem duas fontes de item desde 29/08/2026: conta avulsa
        // e parcela de PP aprovada no cartão. Somar só a primeira faria a
        // faixa não bater com a tabela.
        "parcelas_pp:pedidos_compra_parcelas(valor, pago_em), " +
        // Desde a 093 o item confirmado na baixa JÁ é lançamento na fatura
        // aberta (papel item/ajuste). Sem esta perna a faixa dizia "0 itens"
        // para uma fatura com compra dentro, e o fechamento abria com a
        // soma errada.
        "lancamentos:lancamentos_financeiros!fatura_cartao_id(valor, natureza, papel_na_fatura)",
    )
    .eq("tenant_id", session.activeTenant.id)
    // Fechada entra junto: ela ainda mora na aba Cartão, com o botão de
    // reabrir. A paga não — essa vive em Títulos a Pagar, e desfazê-la é
    // estorno da baixa, não reabertura (29/08/2026).
    .in("status", ["aberta", "fechada"])
    // Ordem de competência: quando um cartão tem mais de uma aberta — a
    // compra que chegou depois do fechamento e rolou para a seguinte —, a
    // que fecha primeiro é a que o financeiro fecha primeiro.
    .order("competencia_fechamento", { ascending: true });

  const faturasDoCartao: FaturaDoCartao[] = (
    (faturasAbertasRes ?? []) as any[]
  ).map((f) => {
    const todos = (f.itens ?? []) as Array<{
      valor: number;
      status: string;
      natureza: "entrada" | "saida";
    }>;
    const ppTodas = (f.parcelas_pp ?? []) as Array<{
      valor: number;
      pago_em: string | null;
    }>;
    // Os itens que já são lançamento (confirmados na baixa, estornos de
    // compra, ajustes de um fechamento anterior). Assinados: estorno é
    // entrada e abate.
    const lancs = ((f.lancamentos ?? []) as Array<{
      valor: number;
      natureza: "entrada" | "saida";
      papel_na_fatura: string | null;
    }>).filter((l) => l.papel_na_fatura === "item" || l.papel_na_fatura === "ajuste");
    const somaLancs = lancs.reduce(
      (s, l) => s + (l.natureza === "entrada" ? -Number(l.valor ?? 0) : Number(l.valor ?? 0)),
      0,
    );
    // Na aberta os itens estão em "aprovada" (e a parcela de PP com
    // pago_em nulo); na fechada os dois já viraram lançamento. Contar só
    // os abertos numa fatura fechada daria zero itens e zero reais.
    const fechada = f.status === "fechada";
    const itens = fechada
      ? todos
      : todos.filter((i) => i.status === "aprovada");
    const parcelasPP = fechada
      ? ppTodas
      : ppTodas.filter((p) => p.pago_em === null);
    return {
      id: f.id,
      codigo: f.codigo,
      cartao_credito_id: f.cartao_credito_id,
      empresa_id: f.cartao?.empresa_id ?? null,
      competencia_fechamento: f.competencia_fechamento,
      data_vencimento: f.data_vencimento,
      // Com sinal: o estorno é 'entrada' e ABATE a fatura. Somar tudo
      // como positivo inflaria o total e faria o fechamento pedir um
      // ajuste que não existe (29/08/2026). Na fechada quem manda é o
      // valor cobrado, que já embute o ajuste.
      // Aberta: o que já é lançamento + o legado ainda pendente (avulsa
      // aprovada e parcela sem pago_em, roteadas antes da 093). Fechada:
      // o valor cobrado, que já embute o ajuste.
      soma_itens: fechada
        ? Number(f.valor_cobrado ?? 0)
        : somaLancs +
          itens.reduce(
            (s, i) =>
              s +
              (i.natureza === "entrada"
                ? -Number(i.valor ?? 0)
                : Number(i.valor ?? 0)),
            0,
          ) +
          // Parcela de PP é sempre saída: não há estorno de PP no cartão
          // (decidido em 29/08/2026).
          parcelasPP.reduce((s, p) => s + Number(p.valor ?? 0), 0),
      qtd_itens: (fechada ? 0 : lancs.length) + itens.length + parcelasPP.length,
      status: f.status as "aberta" | "fechada",
    };
  });

  // ---- Faturas de cartão FECHADAS ----
  //
  // A fatura desce para Títulos a Pagar como UM título. Os itens de dentro
  // dela nunca aparecem aqui: seriam dezenas de linhas para uma única
  // baixa, e é exatamente isso que a aba Cartão existe para evitar
  // (28/08/2026).
  //
  // Só fechada e paga: a fatura ABERTA ainda recebe compra, e não faz
  // sentido oferecer baixa de um valor que ainda vai mudar.
  const { data: faturasRes, error: faturasErr } = await supabase
    .from("faturas_cartao")
    .select(SELECT_FATURA_DO_TITULO)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["fechada", "paga"]);

  if (faturasErr) {
    console.error("[contas-a-pagar.faturas-cartao]", faturasErr.message);
  }

  // Títulos a pagar — a visão unificada (PP, avulso, recorrência, folha,
  // desembolso, estorno de verba e fatura de cartão). A montagem mora em
  // `dados-dos-titulos.ts` desde 02/10/2026: a aba Títulos da conciliação
  // monta os mesmos títulos com ela.
  const titulos = montarTitulosAPagar({
    pps: rows,
    avulsas: avulsasRes.data,
    baixas: baixasRes.data,
    estornos: estornosRes.data,
    desembolsos: desembolsosTitulosRes.data,
    devolucoes: devolucoesRes.data,
    faturas: faturasRes,
    remessasItens: remessasItensRes.data,
    tipos: tiposRes.data,
  });

  // Aba "Cartão" — TODOS os títulos de cartão (a pagar + pagos). O filtro
  // de status é interno na lista, padrão "a pagar".
  const titulosCartao = titulos.filter(
    (t) => t.forma_pagamento === "cartao_credito",
  );
  // Badge da aba (093 §13): o que espera o financeiro no cartão é FECHAR a
  // fatura cujo dia de fechamento já passou — não o legado "a pagar", que
  // tende a zero desde a 093. Mesmo critério dos outros badges: pendência
  // de ação, não volume.
  // Fuso da casa: o servidor roda em UTC e, depois das 21h, o "hoje" dele
  // já é amanhã — a fatura que fecha hoje contaria como vencida.
  const hojeISO = hojeEmSaoPauloIso();
  const titulosCartaoCount = faturasDoCartao.filter(
    (f) => f.status === "aberta" && f.competencia_fechamento < hojeISO,
  ).length;

  // Aba "Títulos a Pagar" — TODOS os não-cartão (a pagar + pagos). Filtro
  // de status também é interno, padrão "a pagar".
  const titulosNaoCartao = titulos.filter(
    (t) => t.forma_pagamento !== "cartao_credito",
  );
  const titulosAPagarCount = titulosNaoCartao.filter((t) => t.status === "a_pagar").length;

  // Mapeamento das recorrências para RecorrenteRow
  const recorrentesRows: RecorrenteRow[] = ((recorrentesRes.data ?? []) as unknown as Array<{
    id: string;
    descricao: string;
    valor: string | number;
    frequencia: "mensal" | "quinzenal" | "anual";
    dia_do_mes: number | null;
    dia_quinzena_1: number | null;
    dia_quinzena_2: number | null;
    dia_do_ano_dia: number | null;
    dia_do_ano_mes: number | null;
    proxima_data: string;
    data_fim: string | null;
    ativo: boolean;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
    empresa: { razao_social: string | null; nome_fantasia: string | null } | null;
    tipo: { codigo: string } | null;
    subtipo: { nome: string } | null;
  }>).map((r) => ({
    id: r.id,
    descricao: r.descricao,
    valor: Number(r.valor),
    frequencia: r.frequencia,
    dia_do_mes: r.dia_do_mes,
    dia_quinzena_1: r.dia_quinzena_1,
    dia_quinzena_2: r.dia_quinzena_2,
    dia_do_ano_dia: r.dia_do_ano_dia,
    dia_do_ano_mes: r.dia_do_ano_mes,
    proxima_data: r.proxima_data,
    data_fim: r.data_fim,
    ativo: r.ativo,
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? null,
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    tipo_codigo: r.tipo?.codigo ?? "",
    subtipo_nome: r.subtipo?.nome ?? "",
  }));

  // Listas para os dropdowns do drawer de conta avulsa
  const empresasList = (empresasRes.data ?? []).map((e: { id: string; razao_social: string | null; nome_fantasia: string | null }) => ({
    id: e.id,
    nome: e.razao_social ?? e.nome_fantasia ?? "",
  }));
  // `cpf_cnpj` vai para a tela (é a segunda linha da opção e a chave de
  // busca do campo, decisão 067). Os nove campos de pagamento NÃO vão —
  // eles ficam no servidor, alimentando só o cálculo do asterisco.
  const fornecedoresList = (fornecedoresRes.data ?? []).map((f: { id: string; nome: string; razao_social: string | null; cpf_cnpj: string | null }) => ({
    id: f.id,
    nome: f.razao_social ?? f.nome,
    cpf_cnpj: f.cpf_cnpj,
  }));
  const clientesList = (clientesRes.data ?? []).map((c: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
    id: c.id,
    nome: c.razao_social ?? c.nome_fantasia ?? "",
  }));

  const regionaisList = (regionaisRes.data ?? []).map(
    (r: { id: string; nome: string; ativo: boolean; empresa_id: string }) => ({
      id: r.id,
      nome: r.nome,
      ativo: r.ativo,
      empresa_id: r.empresa_id,
    }),
  );

  // -------------------------------------------------------------------
  // Desembolsos — mapeamento para DesembolsoRow
  // -------------------------------------------------------------------

  const desembolsosRows: DesembolsoRow[] = (
    (desembolsosRes.data ?? []) as unknown as Array<{
      id: string;
      codigo: string;
      descricao: string;
      valor: string | number;
      status: DesembolsoStatus;
      data_prevista_pagamento: string | null;
      motivo_rejeicao: string | null;
      motivo_cancelamento: string | null;
      aprovada_em: string | null;
      rejeitada_em: string | null;
      cancelada_em: string | null;
      pago_em: string | null;
      created_at: string;
      empresa: { id: string; razao_social: string | null; nome_fantasia: string | null } | null;
      fornecedor: { id: string; nome: string; razao_social: string | null } | null;
      criador: { nome: string } | null;
    }>
  ).map((d) => ({
    id: d.id,
    codigo: d.codigo,
    descricao: d.descricao,
    valor: Number(d.valor),
    status: d.status,
    data_prevista_pagamento: d.data_prevista_pagamento,
    motivo_rejeicao: d.motivo_rejeicao,
    motivo_cancelamento: d.motivo_cancelamento,
    aprovada_em: d.aprovada_em,
    rejeitada_em: d.rejeitada_em,
    cancelada_em: d.cancelada_em,
    pago_em: d.pago_em,
    created_at: d.created_at,
    empresa_nome: d.empresa?.razao_social ?? d.empresa?.nome_fantasia ?? "—",
    fornecedor_nome: d.fornecedor?.razao_social ?? d.fornecedor?.nome ?? "—",
    criador_nome: d.criador?.nome ?? "—",
  }));

  const desembolsosPendentesCount = desembolsosRows.filter(
    (d) => d.status === "em_avaliacao",
  ).length;

  const cartoesList = (cartoesRes.data ?? []).map(
    (c: {
      id: string;
      nome: string;
      banco: string;
      bandeira: string;
      ultimos_4_digitos: string;
      dia_vencimento_fatura: number;
      dia_fechamento_fatura: number | null;
    }) => ({
      id: c.id,
      nome: c.nome,
      banco: c.banco,
      // O PostgREST retorna o enum como string — a coluna é do tipo
      // `bandeira_cartao` que corresponde a `BandeiraCartao` no TS.
      bandeira: c.bandeira as BandeiraCartao,
      ultimos_4_digitos: c.ultimos_4_digitos,
      dia_vencimento_fatura: c.dia_vencimento_fatura,
      dia_fechamento_fatura: c.dia_fechamento_fatura ?? null,
    }),
  );

  // -------------------------------------------------------------------
  // Folhas de pagamento — mapeamento pra tab "Folhas de Pagamento"
  // -------------------------------------------------------------------
  const folhasParaTab: FolhaLinhaFinanceiro[] = ((folhasRes.data ?? []) as any[]).map(
    (l) => ({
      id: l.id,
      competencia_ano: l.competencia_ano,
      competencia_mes: l.competencia_mes,
      salario_base: String(l.salario_base),
      status: l.status,
      motivo_pendencia: l.motivo_pendencia,
      // Sem o colaborador no RPC, a linha aparece com travessão e sem
      // pagamento — nunca com dado inventado.
      colaborador: cnabColaboradoresRes.get(l.colaborador_id) ?? {
        id: l.colaborador_id,
        nome: "—",
        funcao: "—",
        tipo_contratacao: "pj",
        status: "ativo",
        cpf: null,
        cnpj: null,
        razao_social: null,
        pix_tipo: null,
        pix_chave: null,
        banco_codigo: null,
        banco_nome: null,
        agencia: null,
        agencia_dv: null,
        conta: null,
        conta_dv: null,
        tipo_conta: null,
      },
      alocacoes: ((l.alocacoes ?? []) as any[]).map((a) => ({
        id: a.id,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: String(a.percentual),
        empresa_nome: a.empresa?.nome_fantasia ?? "",
        regional_nome: a.regional?.nome ?? "",
      })),
    }),
  );
  const empresasParaFolha = (empresasRes.data ?? []).map(
    (e: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
      id: e.id,
      nome_fantasia: e.nome_fantasia ?? e.razao_social ?? "",
    }),
  );
  const regionaisParaFolha = (regionaisRes.data ?? []).map(
    (r: { id: string; nome: string; empresa_id: string }) => ({
      id: r.id,
      nome: r.nome,
      empresa_id: r.empresa_id,
    }),
  );
  // ---- Aba Cartão (decisão 093, entrega 2) ----
  //
  // A capa: um card por cartão ativo com a fatura EM CURSO — a aberta mais
  // antiga (é a que o financeiro fecha primeiro; `faturasDoCartao` já vem
  // nessa ordem), senão a fechada que espera baixa. A soma é a mesma da
  // faixa que o fechamento usa.
  const capa: CartaoDaCapa[] = cartoesList.map((cartao) => {
    const minhas = faturasDoCartao.filter((f) => f.cartao_credito_id === cartao.id);
    const emCurso =
      minhas.find((f) => f.status === "aberta") ??
      minhas.find((f) => f.status === "fechada") ??
      null;
    return {
      cartao,
      emCurso: emCurso
        ? {
            id: emCurso.id,
            codigo: emCurso.codigo,
            competencia: chaveCompetencia(competenciaDaData(emCurso.competencia_fechamento)),
            status: emCurso.status,
            total: emCurso.soma_itens,
            qtd_itens: emCurso.qtd_itens,
            fecha: emCurso.competencia_fechamento,
            vence: emCurso.data_vencimento,
          }
        : null,
    };
  });

  // Dentro do cartão: a fatura da competência pedida, como extrato. Sem
  // competência na URL, a da fatura em curso; sem fatura nenhuma, o mês de
  // hoje. A leitura do extrato é a única ida ao banco fora do
  // `Promise.all` — depende de saber QUAL fatura tem aquela competência.
  let tela: FaturaTela | null = null;
  if (cartaoSelId && cartoesList.some((c) => c.id === cartaoSelId)) {
    if (faturasDoCartaoSelRes.error) {
      console.error("[contas-a-pagar.faturas-do-cartao]", faturasDoCartaoSelRes.error.message);
    }
    const somaAberta = new Map(faturasDoCartao.map((f) => [f.id, f.soma_itens]));
    const faturasSel = (
      (faturasDoCartaoSelRes.data ?? []) as Array<{
        id: string;
        codigo: string;
        competencia_fechamento: string;
        data_vencimento: string;
        status: string;
        valor_cobrado: number | string | null;
      }>
    ).map((f) => ({
      id: f.id,
      codigo: f.codigo,
      competencia: chaveCompetencia(competenciaDaData(f.competencia_fechamento)),
      status: f.status as StatusFatura,
      // Aberta: a soma viva dos itens. Fechada ou paga: o que o banco cobrou.
      total: f.status === "aberta" ? somaAberta.get(f.id) ?? 0 : Number(f.valor_cobrado ?? 0),
    }));
    const emCursoDoCartao = capa.find((c) => c.cartao.id === cartaoSelId)?.emCurso ?? null;
    const competencia =
      lerCompetencia(searchParams?.competencia) ??
      (emCursoDoCartao ? lerCompetencia(emCursoDoCartao.competencia) : null) ??
      competenciaAtual();
    const chave = chaveCompetencia(competencia);
    const faturaSel = faturasSel.find((f) => f.competencia === chave) ?? null;
    const extrato = faturaSel
      ? await carregarExtratoDaFatura(supabase, session.activeTenant.id, faturaSel.id)
      : null;
    tela = { cartaoId: cartaoSelId, competencia: chave, extrato, faturas: faturasSel };
  }

  // -------------------------------------------------------------------
  // CNAB: dados pra o Dialog de "Exportar remessa Santander"
  // -------------------------------------------------------------------
  const contasSantander: ContaSantanderElegivel[] = ((contasRes.data ?? []) as ContaBancaria[])
    .filter(
      (c) =>
        c.ativo &&
        c.banco.toLowerCase().includes("santander") &&
        c.convenio_cnab_santander !== null &&
        c.agencia !== null &&
        c.numero_conta !== null &&
        c.numero_conta_dv !== null,
    )
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      agencia: c.agencia!,
      numero_conta: c.numero_conta!,
      numero_conta_dv: c.numero_conta_dv!,
    }));

  // Decisão 137: chave e conta vão ao diálogo, para a coluna "Dados de
  // pagamento". `temPix`/`temBanco` seguem as mesmas regras do gerador.
  type DestinoNaRemessa = {
    nome: string;
    temPix: boolean;
    temBanco: boolean;
    pix: TituloElegivelParaRemessa["pix"];
    conta: TituloElegivelParaRemessa["conta"];
  };
  const pixDe = (tipo: string | null, chave: string | null): DestinoNaRemessa["pix"] =>
    tipo && chave ? { tipo: tipo as PixTipoChave, chave } : null;
  const contaDe = (d: {
    banco_codigo: string | null;
    banco_nome: string | null;
    agencia: string | null;
    agencia_dv: string | null;
    conta: string | null;
    conta_dv: string | null;
    tipo_conta: string | null;
  }): DestinoNaRemessa["conta"] =>
    d.banco_codigo && d.agencia && d.conta && d.conta_dv
      ? {
          banco_codigo: d.banco_codigo,
          banco_nome: d.banco_nome,
          agencia: d.agencia,
          agencia_dv: d.agencia_dv,
          conta: d.conta,
          conta_dv: d.conta_dv,
          tipo_conta: (d.tipo_conta as TipoContaBancariaFornecedor | null) ?? null,
        }
      : null;
  const fornecedorBancoMap = new Map<string, DestinoNaRemessa>();
  for (const f of (fornecedoresRes.data ?? []) as Array<{
    id: string;
    nome: string;
    banco_codigo: string | null;
    banco_nome: string | null;
    agencia: string | null;
    agencia_dv: string | null;
    conta: string | null;
    conta_dv: string | null;
    tipo_conta: string | null;
    pix_tipo: string | null;
    pix_chave: string | null;
  }>) {
    const pix = pixDe(f.pix_tipo, f.pix_chave);
    const conta = contaDe(f);
    fornecedorBancoMap.set(f.id, { nome: f.nome, temPix: !!pix, temBanco: !!conta, pix, conta });
  }
  const colaboradorBancoMap = new Map<string, DestinoNaRemessa>();
  for (const c of cnabColaboradoresRes.values()) {
    colaboradorBancoMap.set(c.id, {
      nome: c.nome,
      temPix: temPix(c),
      temBanco: temConta(c),
      pix: temPix(c) ? pixDe(c.pix_tipo, c.pix_chave) : null,
      conta: temConta(c) ? contaDe(c) : null,
    });
  }
  // A PP fora do cadastro paga pela chave ou conta dela (decisão 137): o
  // título da remessa é a parcela, então o mapa vai da parcela à PP.
  const foraPorParcela = new Map<string, PagamentoForaDoCadastroDaPP>();
  for (const pp of rows) {
    if (!pp.pagamento_fora_do_cadastro) continue;
    for (const par of pp.parcelas) foraPorParcela.set(par.id, pp.pagamento_fora_do_cadastro);
  }
  // Decisão 145: a remessa paga a parcela de PP pelo líquido — o que falta
  // menos a retenção da aprovação, pela mesma conta da geração do arquivo.
  const linhasDaAprovacao = new Map<string, Array<{ imposto: string; aliquota: number | string | null }>>();
  for (const r of (retencoesDaAprovacaoRes.data ?? []) as Array<{
    pedido_compra_id: string;
    imposto: string;
    aliquota: number | string | null;
  }>) {
    const lista = linhasDaAprovacao.get(r.pedido_compra_id) ?? [];
    lista.push(r);
    linhasDaAprovacao.set(r.pedido_compra_id, lista);
  }
  const aliquotasPorParcela = new Map<string, ReturnType<typeof aliquotasDaParcela>>();
  for (const pp of rows) {
    const aliquotas = aliquotasDaParcela({
      verba: pp.verba_producao,
      remessa: null,
      aliquotas: montarRetencaoDaAprovacao(linhasDaAprovacao.get(pp.id) ?? [], null)?.aliquotas ?? null,
    });
    if (!aliquotas) continue;
    for (const par of pp.parcelas) aliquotasPorParcela.set(par.id, aliquotas);
  }

  const titulosCnab: TituloElegivelParaRemessa[] = ((cnabAPagarRes.data ?? []) as Array<{
    origem_tipo: string;
    origem_id: string;
    descricao: string;
    valor: string | number;
    fornecedor_id: string | null;
    colaborador_id: string | null;
  }>)
    .map((row) => {
      let destinatario: DestinoNaRemessa | null = null;
      let destinatarioTipo: "fornecedor" | "colaborador" | null = null;
      if (row.colaborador_id) {
        destinatario = colaboradorBancoMap.get(row.colaborador_id) ?? null;
        destinatarioTipo = "colaborador";
      } else if (row.fornecedor_id) {
        destinatario = fornecedorBancoMap.get(row.fornecedor_id) ?? null;
        destinatarioTipo = "fornecedor";
      }
      if (!destinatario || !destinatarioTipo) return null;
      // A view expõe "pp"/"avulsa"/"folha"/"recorrente"/"desembolso" — todos válidos.
      const origemTipo = row.origem_tipo as
        | "pp"
        | "avulsa"
        | "folha"
        | "recorrente"
        | "desembolso";
      const fora = origemTipo === "pp" ? (foraPorParcela.get(row.origem_id) ?? null) : null;
      const pixFora = fora?.meio === "pix" ? pixDe(fora.pix_tipo, fora.pix_chave) : null;
      const contaFora = fora?.meio === "conta" ? contaDe(fora) : null;
      const bruto = Number(row.valor);
      const { retido, liquido } =
        origemTipo === "pp"
          ? retencoesPelaAprovacao(bruto, aliquotasPorParcela.get(row.origem_id) ?? null)
          : { retido: 0, liquido: bruto };
      const linha: TituloElegivelParaRemessa = {
        origemTipo,
        origemId: row.origem_id,
        descricao: row.descricao,
        valor: liquido,
        bruto,
        retido,
        destinatarioNome: destinatario.nome,
        destinatarioTipo,
        // Fora do cadastro, só o meio da PP vale: a forma fica fixa.
        temPix: fora ? !!pixFora : destinatario.temPix,
        temBanco: fora ? !!contaFora : destinatario.temBanco,
        pix: fora ? pixFora : destinatario.pix,
        conta: fora ? contaFora : destinatario.conta,
        foraDoCadastro: fora,
      };
      return linha;
    })
    .filter((t): t is TituloElegivelParaRemessa => t !== null)
    .sort((a, b) =>
      a.destinatarioNome.localeCompare(b.destinatarioNome, "pt-BR"),
    );

  const canGerarRemessa = pode(session.activeRole, "financeiro.contas_pagar");

  // Disparada junto das linhas das PPs (ver acima); nunca rejeita.
  const fiscalDaAprovacao = await fiscalDaAprovacaoPromise;

  return (
    <div className="space-y-8">
      <BotaoVoltar reserva="/financeiro" />
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Contas a Pagar"
        description="Pedidos de Produção, títulos a pagar e recorrências que envolvem dinheiro a sair. Aprove e rejeite os PPs; dê baixa nos títulos para enviá-los à conciliação."
        icon={Wallet}
        showEmpresaFilter
        empresas={session.empresasVisiveis}
        activeEmpresas={activeEmpresasEfetivas}
      />

      <ChatPPsProvider
        conversasIniciais={conversasChatPPs}
        podeEnviar={pode(session.activeRole, "chat.enviar_financeiro")}
      >
        <ContasPagarTabs
          pps={
            <PedidosCompraList
              rows={rows}
              tenantId={session.activeTenant.id}
              regionais={regionaisList}
              cartoes={cartoesList}
              tipos={tiposRes.data ?? []}
              subtipos={subtiposRes.data ?? []}
              fiscal={fiscalDaAprovacao}
            />
          }
          ppsPendentesCount={ppsPendentesCountRes.count ?? 0}
          desembolsos={<DesembolsosContasPagarList rows={desembolsosRows} cartoes={cartoesList} />}
          desembolsosPendentesCount={desembolsosPendentesCount}
          titulos={
            <TitulosPagarList
              rows={titulosNaoCartao}
              tenantId={session.activeTenant.id}
              contas={contasRes.data ?? []}
              tipos={tiposRes.data ?? []}
              subtipos={subtiposRes.data ?? []}
              empresas={empresasList}
              fornecedores={fornecedoresList}
              clientes={clientesList}
              regionais={regionaisList}
              cartoes={cartoesList}
              ultimasRetencoes={ultimasRetencoes}
              podeDevolverFolha={pode(session.activeRole, "rh.folhas.aprovar_financeiro")}
              exportarRemessaBotao={
                <ExportarRemessaCnabDialog
                  contasSantander={contasSantander}
                  titulos={titulosCnab}
                  canGerar={canGerarRemessa}
                />
              }
            />
          }
          titulosAPagarCount={titulosAPagarCount}
          recorrentes={
            <RecorrentesList
              rows={recorrentesRows}
              tenantId={session.activeTenant.id}
              empresas={empresasList}
              tipos={tiposRes.data ?? []}
              subtipos={subtiposRes.data ?? []}
              fornecedores={fornecedoresList}
              clientes={clientesList}
              regionais={regionaisList}
              cartoes={cartoesList}
            />
          }
          recorrentesAtivasCount={recorrentesAtivasCountRes.count ?? 0}
          folhas={
            <FolhasPagarList
              linhas={folhasParaTab}
              empresas={empresasParaFolha}
              regionais={regionaisParaFolha}
            />
          }
          folhasPendentesCount={folhasParaTab.length}
          titulosCartao={
            <CartaoTab
              cartoes={cartoesList}
              capa={capa}
              tela={tela}
              faturasDoCartao={faturasDoCartao}
              titulos={titulosCartao}
              tipos={tiposRes.data ?? []}
              subtipos={subtiposRes.data ?? []}
              tenantId={session.activeTenant.id}
              empresas={empresasList}
              fornecedores={fornecedoresList}
              clientes={clientesList}
              regionais={regionaisList}
            />
          }
          titulosCartaoCount={titulosCartaoCount}
          tabInicial={lerTab(searchParams?.tab)}
        />
      </ChatPPsProvider>
    </div>
  );
}
