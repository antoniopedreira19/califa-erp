/**
 * Os títulos de Contas a Pagar, montados num lugar só (02/10/2026).
 *
 * Até aqui as consultas e a montagem moravam dentro de `page.tsx`. A aba
 * Títulos da conciliação (pedido do Tiago em 02/10/2026) mostra os MESMOS
 * títulos em aberto, e por isso elas saíram da página sem mudar nada: o
 * `select` de cada consulta, o mapeamento das PPs e as regras de cada
 * origem são os mesmos para a lista de Títulos a Pagar e para a aba da
 * conciliação. Mudou aqui, muda nas duas.
 *
 * Módulo do servidor, sem "use client". Os tipos `PPRow` e `TituloRow`
 * continuam nas listas, que são de quem os desenha.
 */

import { situacaoDaVerba } from "@/lib/types";
import type { DocumentoTipo, FormaPagamento, PlanoContaTipo, PPStatus } from "@/lib/types";
import { notaFiscalDaLinhaPP, regimeDoFornecedorDaPP } from "@/lib/fiscal/nf-da-pp";
import {
  SELECT_PRESTACAO_DA_VERBA,
  devolucaoDaVerba,
  prestacaoDaVerba,
} from "@/lib/data/prestacao-da-verba";
import {
  SELECT_EVENTOS_DA_PP,
  eventosDaPP,
  pedidoForaDoCadastro,
} from "@/lib/data/eventos-da-pp";
import {
  cadastroMudouDepoisDaFoto,
  lerPagamentoForaDoCadastro,
  type DadosDePagamento,
  type FotoDePagamentoDaPP,
} from "@/lib/data/foto-pagamento-da-pp";
import { agruparEstornosPorBaixa } from "@/lib/data/estornos-de-baixa";
import {
  SELECT_BAIXA_DO_DOCUMENTO,
  agruparBaixasPorDocumento,
  totalBaixado,
} from "@/lib/data/baixas-do-documento";
import type { PPRow } from "./pedidos-compra-list";
import type { TituloRow } from "./titulos-pagar-list";

// ---------------------------------------------------------------------------
// As consultas — o `select` de cada uma. Os filtros ficam com quem consulta:
// a página filtra pela empresa do cabeçalho e pelo atalho "vencidas"; a
// conciliação, só pelo que está em aberto.
// ---------------------------------------------------------------------------

/** `pedidos_compra`: a PP inteira, como a aba de PPs e os títulos usam. */
export const SELECT_PP_DO_FINANCEIRO = `
        id, codigo, status, valor, quantidade, servico, especificacoes,
        prazo_pagamento, prazo_pagamento_financeiro, pdf_path, created_at,
        dados_pagamento_congelados_em,
        fornecedor_banco_codigo, fornecedor_banco_nome,
        fornecedor_agencia, fornecedor_agencia_dv,
        fornecedor_conta, fornecedor_conta_dv, fornecedor_tipo_conta,
        fornecedor_pix_tipo, fornecedor_pix_chave,
        pagamento_fora_do_cadastro_meio, pagamento_fora_do_cadastro_motivo,
        cancelada_em, motivo_cancelamento,
        rejeitada_em, motivo_rejeicao, pago_em, verba_producao,
        enviada_financeiro_em, aprovada_em, anexos_na_aprovacao,
        urgente, urgente_justificativa, urgente_em,
        forma_pagamento, cartao_credito_id,
        plano_conta_tipo_id, plano_conta_subtipo_id,
        nf_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id,
        nf_registrada_em, credito_pis_cofins_retirado, credito_pis_cofins_motivo,
        fornecedor:fornecedores(
          id, nome, razao_social,
          regime_tributario, regime_consultado_em, declaracao_simples_recebida
        ),
        responsavel:profiles!responsavel_verba_id(id, nome),
        empresa:empresas(id, razao_social, nome_fantasia),
        cancelada_por_profile:profiles!cancelada_por(nome),
        emitida_por_profile:profiles!emitida_por(nome),
        rejeitada_por_profile:profiles!rejeitada_por(nome),
        pago_por_profile:profiles!pago_por(nome),
        aprovada_por_profile:profiles!aprovada_por(nome),
        enviada_por_profile:profiles!enviada_financeiro_por(nome),
        urgente_por_profile:profiles!urgente_por(nome),
        job:jobs(
          id, codigo, nome, regional_id,
          responsavel:profiles!responsavel_id(nome),
          projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))
        ),
        ${SELECT_PRESTACAO_DA_VERBA},
        ${SELECT_EVENTOS_DA_PP},
        anexos:pedidos_compra_anexos(
          id, arquivo_nome_original, arquivo_tamanho_bytes, created_at,
          documento_tipo, documento_numero
        ),
        parcelas:pedidos_compra_parcelas(
          id, numero, data_vencimento, data_pagamento, data_pagamento_primeira,
          valor, pago_em, fatura_cartao_id
        )
`;

/** `contas_avulsas` de saída (sem `tipo_entrada`): avulso, recorrência e
 *  folha. */
export const SELECT_AVULSA_A_PAGAR = `
          id, descricao, valor, natureza, data_prevista_pagamento,
          data_pagamento, data_pagamento_primeira, status,
          pago_em, created_at, empresa_id, recorrente_id, folha_id,
          plano_conta_tipo_id, plano_conta_subtipo_id,
          forma_pagamento, cartao_credito_id, fatura_cartao_id,
          estorno_de_avulsa_id, parcela_numero, parcela_total, parcela_de_avulsa_id,
          fornecedor_id, fornecedor:fornecedores(nome, razao_social)
`;

/** `lancamentos_financeiros`: as baixas dos documentos a pagar. */
export const SELECT_BAIXA_A_PAGAR = `
        ${SELECT_BAIXA_DO_DOCUMENTO},
        pedido_compra_parcela_id, conta_avulsa_id, desembolso_parcela_id,
        pp_verba_devolucao_id, forma_pagamento, cartao_credito_id
`;

/** As origens das baixas dos documentos a pagar. */
export const ORIGENS_DA_BAIXA_A_PAGAR = [
  "pp_baixa",
  "avulsa_baixa",
  "desembolso_baixa",
  "pp_devolucao_verba",
];

/** As origens dos estornos dessas baixas (decisão 120). */
export const ORIGENS_DO_ESTORNO_A_PAGAR = [
  "pp_estorno",
  "avulsa_estorno",
  "desembolso_estorno",
  "pp_devolucao_verba_estorno",
];

/** `desembolsos` aprovados ou pagos, com as parcelas. */
export const SELECT_DESEMBOLSO_DO_TITULO = `
        id, codigo, descricao, status,
        empresa_id, forma_pagamento, cartao_credito_id,
        fornecedor:fornecedores(nome, razao_social),
        parcelas:desembolsos_parcelas(
          id, numero, data_vencimento, data_pagamento, data_pagamento_primeira,
          valor, pago_em
        )
`;

/** `pp_verba_devolucoes`: o estorno da verba de produção. */
export const SELECT_DEVOLUCAO_DE_VERBA = `
        id, tenant_id, empresa_id, valor, data_pagamento, data_pagamento_primeira,
        pago_em, pago_por,
        pp:pedidos_compra!pedido_compra_id(id, codigo, servico, job_id,
          plano_conta_tipo_id, plano_conta_subtipo_id,
          responsavel:profiles!responsavel_verba_id(nome),
          job:jobs(id, codigo, nome)
        )
`;

/** `cnab_remessas_itens`: o que já foi para uma remessa. Quem consulta tira
 *  a remessa cancelada (`.neq("remessa.status", "cancelado")`). */
export const SELECT_ITEM_EM_REMESSA = "origem_id, remessa:cnab_remessas!inner(status)";

/** `faturas_cartao` fechadas ou pagas: a fatura desce como UM título. */
export const SELECT_FATURA_DO_TITULO =
  "id, codigo, competencia_fechamento, data_vencimento, status, valor_cobrado, " +
  "cartao:cartoes_credito!inner(nome, ultimos_4_digitos, empresa_id), " +
  // A perna bancária do pagamento: é dela que saem "Pago em",
  // "Conta" e "Centro de custo" na conferência da baixa. Sem isso a
  // fatura paga abria com três travessões (29/08/2026). O filtro
  // por papel evita pegar o lançamento do cartão ou o do estorno.
  "pagamentos:lancamentos_financeiros!fatura_cartao_id(" +
  "data_movimento, papel_na_fatura, origem, " +
  "conta:contas_bancarias(nome, banco, cartao_credito_id), " +
  "tipo:plano_contas_tipos(codigo, nome), subtipo:plano_contas_subtipos(nome))";

// ---------------------------------------------------------------------------
// As PPs
// ---------------------------------------------------------------------------

/**
 * As PPs na forma da tela (`PPRow`), a partir da consulta
 * `SELECT_PP_DO_FINANCEIRO` e dos fornecedores ativos com os campos de
 * pagamento (`COLUNAS_DE_PAGAMENTO`), que alimentam o asterisco da 067.
 */
export function mapearPPsDoFinanceiro(
  data: unknown[] | null,
  fornecedores: unknown[] | null,
): PPRow[] {
  /**
   * Cadastro de pagamento de cada fornecedor ativo, para o asterisco da
   * decisão 067. Fica num Map porque o laço das PPs consulta uma vez por
   * linha, e a lista de fornecedores já veio no `Promise.all`.
   */
  const cadastroDePagamentoPorFornecedor = new Map<string, DadosDePagamento>(
    ((fornecedores ?? []) as Array<
      { id: string } & DadosDePagamento
    >).map((f) => [
      f.id,
      {
        banco_codigo: f.banco_codigo,
        banco_nome: f.banco_nome,
        agencia: f.agencia,
        agencia_dv: f.agencia_dv,
        conta: f.conta,
        conta_dv: f.conta_dv,
        tipo_conta: f.tipo_conta,
        pix_tipo: f.pix_tipo,
        pix_chave: f.pix_chave,
      },
    ]),
  );

  return ((data ?? []) as unknown as Array<FotoDePagamentoDaPP & {
    id: string;
    codigo: string;
    status: PPStatus;
    valor: string | number;
    quantidade: string | number;
    servico: string;
    especificacoes: string | null;
    prazo_pagamento: string;
    prazo_pagamento_financeiro: string | null;
    pdf_path: string;
    created_at: string;
    cancelada_em: string | null;
    motivo_cancelamento: string | null;
    rejeitada_em: string | null;
    motivo_rejeicao: string | null;
    pago_em: string | null;
    verba_producao: boolean;
    dados_pagamento_congelados_em: string | null;
    pagamento_fora_do_cadastro_meio: string | null;
    pagamento_fora_do_cadastro_motivo: string | null;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
    plano_conta_tipo_id: string | null;
    plano_conta_subtipo_id: string | null;
    nf_numero: string | null;
    nf_data_emissao: string | null;
    nf_valor: string | number | null;
    nf_tomador_estabelecimento_id: string | null;
    nf_registrada_em: string | null;
    credito_pis_cofins_retirado: boolean | null;
    credito_pis_cofins_motivo: string | null;
    fornecedor: {
      id: string;
      nome: string;
      razao_social: string | null;
      regime_tributario: string | null;
      regime_consultado_em: string | null;
      declaracao_simples_recebida: boolean | null;
    } | null;
    responsavel: { id: string; nome: string } | null;
    empresa: { id: string; razao_social: string; nome_fantasia: string | null } | null;
    cancelada_por_profile: { nome: string } | null;
    emitida_por_profile: { nome: string } | null;
    rejeitada_por_profile: { nome: string } | null;
    enviada_financeiro_em: string | null;
    aprovada_em: string | null;
    prestacao: unknown;
    devolucao: unknown;
    eventos: unknown;
    anexos_na_aprovacao: Array<{
      id: string;
      nome: string;
      tamanho_bytes: number;
    }> | null;
    aprovada_por_profile: { nome: string } | null;
    enviada_por_profile: { nome: string } | null;
    urgente: boolean | null;
    urgente_justificativa: string | null;
    urgente_em: string | null;
    urgente_por_profile: { nome: string } | null;
    pago_por_profile: { nome: string } | null;
    job: {
      id: string;
      codigo: string;
      nome: string;
      regional_id: string | null;
      responsavel: { nome: string } | null;
      projeto: {
        codigo: string;
        nome: string;
        cliente: { nome_fantasia: string } | null;
      } | null;
    } | null;
    anexos: Array<{
      id: string;
      arquivo_nome_original: string;
      arquivo_tamanho_bytes: number;
      created_at: string;
      documento_tipo: DocumentoTipo | null;
      documento_numero: string | null;
    }>;
    parcelas: Array<{
      id: string;
      numero: number;
      data_vencimento: string;
      data_pagamento: string | null;
      data_pagamento_primeira: string | null;
      valor: string | number;
      pago_em: string | null;
      fatura_cartao_id: string | null;
    }> | null;
  }>).map((r) => ({
    id: r.id,
    codigo: r.codigo,
    status: r.status,
    valor: Number(r.valor),
    quantidade: Number(r.quantidade),
    servico: r.servico,
    especificacoes: r.especificacoes,
    prazo_pagamento: r.prazo_pagamento,
    prazo_pagamento_financeiro: r.prazo_pagamento_financeiro,
    pdf_path: r.pdf_path,
    created_at: r.created_at,
    cancelada_em: r.cancelada_em,
    motivo_cancelamento: r.motivo_cancelamento,
    rejeitada_em: r.rejeitada_em,
    motivo_rejeicao: r.motivo_rejeicao,
    rejeitada_por_nome: r.rejeitada_por_profile?.nome ?? null,
    pago_em: r.pago_em,
    pago_por_nome: r.pago_por_profile?.nome ?? null,
    // Linha do tempo da PP, para a seção "Histórico" do dossiê. O
    // `anexos_na_aprovacao` distingue TRÊS coisas que não podem virar uma
    // só: `null` (aprovada antes de 11/09/2026, sem registro), `[]`
    // (aprovada sem documento) e a lista do que foi conferido.
    enviada_financeiro_em: r.enviada_financeiro_em ?? null,
    enviada_financeiro_por_nome: r.enviada_por_profile?.nome ?? null,
    aprovada_em: r.aprovada_em ?? null,
    aprovada_por_nome: r.aprovada_por_profile?.nome ?? null,
    anexos_na_aprovacao: r.anexos_na_aprovacao ?? null,
    // Pagamento urgente (decisão 077): sobe na lista de aprovação e segue
    // no título depois de aprovada.
    urgente: r.urgente === true,
    urgente_justificativa: r.urgente_justificativa ?? null,
    urgente_em: r.urgente_em ?? null,
    urgente_por_nome: r.urgente_por_profile?.nome ?? null,
    fornecedor_id: r.fornecedor?.id ?? "",
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? "",
    /**
     * Asterisco da decisão 067: o cadastro do fornecedor mudou depois que
     * esta PP tirou a foto dos dados de pagamento.
     *
     * O cálculo é aqui no servidor, e só o booleano segue para a tela —
     * dado bancário não precisa atravessar a fronteira para desenhar um
     * `*`. `cadastroMudouDepoisDaFoto` já devolve `false` para PP sem
     * foto (verba de produção, ou anterior à 067) e para status fora de
     * `em_avaliacao`/`aprovada`/`pago`, então nada disso se repete aqui.
     */
    cadastro_do_fornecedor_mudou: cadastroMudouDepoisDaFoto(
      r,
      r.fornecedor?.id ? cadastroDePagamentoPorFornecedor.get(r.fornecedor.id) : null,
    ),
    // Decisão 127: só o meio trocado. O dossiê mostra, e a aprovação exige
    // a marcação "Aprovar pagamento fora do cadastro".
    pagamento_fora_do_cadastro: lerPagamentoForaDoCadastro(r),
    empresa_id: r.empresa?.id ?? "",
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    job_id: r.job?.id ?? "",
    job_codigo: r.job?.codigo ?? "",
    job_nome: r.job?.nome ?? "",
    regional_id: r.job?.regional_id ?? null,
    // Decisão 136: o GP responsável do job vai como referência nos pop-ups
    // de aprovação — quem age é quem enviou, e qualquer GP envia.
    job_responsavel_nome: r.job?.responsavel?.nome ?? null,
    projeto_codigo: r.job?.projeto?.codigo ?? null,
    projeto_nome: r.job?.projeto?.nome ?? null,
    cliente_nome: r.job?.projeto?.cliente?.nome_fantasia ?? null,
    cancelada_por_nome: r.cancelada_por_profile?.nome ?? null,
    emitida_por_nome: r.emitida_por_profile?.nome ?? null,
    // Escolhidos na aprovação, pelo financeiro (29/08/2026). Antes disso
    // eram sempre null: a forma só existia na baixa.
    forma_pagamento: r.forma_pagamento ?? null,
    cartao_credito_id: r.cartao_credito_id ?? null,
    plano_conta_tipo_id: r.plano_conta_tipo_id ?? null,
    plano_conta_subtipo_id: r.plano_conta_subtipo_id ?? null,
    verba_producao: r.verba_producao ?? false,
    responsavel_nome: r.responsavel?.nome ?? null,
    // Prestação da verba e estorno do saldo, no formato único (decisão 081).
    prestacao: prestacaoDaVerba(r.prestacao),
    devolucao: devolucaoDaVerba(r.devolucao),
    // Histórico de eventos (decisão 136): rejeições, reenvios e quem fez
    // cada um — as colunas acima guardam só o último de cada tipo.
    eventos: eventosDaPP(r.eventos),
    // Ordenados aqui, como as parcelas e pelo mesmo motivo: o embed do
    // PostgREST não garante ordem, e a conferência de documentos numera
    // os anexos 1, 2, 3 — a numeração precisa ser a ordem em que a
    // produção anexou, sempre a mesma a cada carregamento (10/09/2026).
    // `created_at` fica no servidor: a tela usa a ordem, não a data.
    anexos: (r.anexos ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({
        id: a.id,
        arquivo_nome_original: a.arquivo_nome_original,
        arquivo_tamanho_bytes: a.arquivo_tamanho_bytes,
      })),
    // Ordenadas aqui: o embed do PostgREST não garante ordem, e a lista
    // e o drawer mostram "1/3, 2/3, 3/3" na sequência.
    parcelas: (r.parcelas ?? [])
      .map((p) => ({
        id: p.id,
        numero: p.numero,
        data_vencimento: p.data_vencimento,
        data_pagamento: p.data_pagamento,
        data_pagamento_primeira: p.data_pagamento_primeira,
        valor: Number(p.valor),
        pago_em: p.pago_em,
        fatura_cartao_id: p.fatura_cartao_id ?? null,
      }))
      .sort((a, b) => a.numero - b.numero),
    // Módulo fiscal (02/10/2026): o regime do cadastro do fornecedor, que
    // a coluna "Dados da PP" mostra e a retenção usa, e a NF do fornecedor
    // — o número do anexo do tipo NF e o que o financeiro registrou na
    // aprovação. Null fora da PP com NF anexada (verba, recibo, boleto).
    regime_do_fornecedor: regimeDoFornecedorDaPP(r.verba_producao ?? false, r.fornecedor),
    nota_fiscal: notaFiscalDaLinhaPP(r),
  }));
}

// ---------------------------------------------------------------------------
// Os títulos
// ---------------------------------------------------------------------------

/**
 * Os títulos a pagar de todas as origens, a pagar e pagos, cartão e não
 * cartão — quem chama recorta (a página separa a aba Cartão; a conciliação
 * fica com os não cartão a pagar).
 */
export function montarTitulosAPagar(e: {
  /** As PPs já mapeadas (`mapearPPsDoFinanceiro`). */
  pps: PPRow[];
  /** `contas_avulsas` com `SELECT_AVULSA_A_PAGAR`. */
  avulsas: unknown[] | null;
  /** Baixas com `SELECT_BAIXA_A_PAGAR`, de `ORIGENS_DA_BAIXA_A_PAGAR`, da
   *  mais antiga para a mais nova. */
  baixas: unknown[] | null;
  /** Estornos com `SELECT_ESTORNO_DE_BAIXA`, de `ORIGENS_DO_ESTORNO_A_PAGAR`. */
  estornos: unknown[] | null;
  /** `desembolsos` com `SELECT_DESEMBOLSO_DO_TITULO`. */
  desembolsos: unknown[] | null;
  /** `pp_verba_devolucoes` com `SELECT_DEVOLUCAO_DE_VERBA`. */
  devolucoes: unknown[] | null;
  /** `faturas_cartao` com `SELECT_FATURA_DO_TITULO`. */
  faturas: unknown[] | null;
  /** `cnab_remessas_itens` com `SELECT_ITEM_EM_REMESSA`. */
  remessasItens: unknown[] | null;
  /** Os tipos do plano de contas: o Custo Operacional (02) é o centro de
   *  custo sugerido da PP. */
  tipos: Pick<PlanoContaTipo, "id" | "codigo">[] | null;
}): TituloRow[] {
  // -------------------------------------------------------------------
  // Títulos a pagar — a visão unificada
  // -------------------------------------------------------------------
  //
  // Não há tabela de títulos (decisão do plano: nada de tabela-espelho).
  // A lista nasce da união de duas fontes já existentes, agregadas aqui
  // no servidor:
  //   • parcelas de PP aprovada ou paga → origem `pp`
  //   • `contas_avulsas` → `avulso` ou `recorrencia`, conforme
  //     `recorrente_id` (a recorrência materializa ocorrências ali)

  type BaixaInfo = {
    /** O lançamento da baixa viva e a conta dele: o estorno (decisão 120)
     *  se pendura no primeiro e sugere a segunda. */
    lancamento_id: string;
    conta_id: string;
    pago_em: string;
    conta: string;
    /** O centro de custo — o TIPO do plano de contas, "04 · Custo Fixo". */
    centro: string;
    /** O subtipo, que vai numa linha própria da conferência da baixa. */
    subtipo: string | null;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
  };

  const baixaPorParcela = new Map<string, BaixaInfo>();
  const baixaPorAvulsa = new Map<string, BaixaInfo>();
  const baixaPorDesembolsoParcela = new Map<string, BaixaInfo>();
  const baixaPorDevolucao = new Map<string, BaixaInfo>();

  const estornosPorBaixa = agruparEstornosPorBaixa(e.estornos);
  // Todas as baixas de cada documento (decisão 125).
  const baixasDaParcela = agruparBaixasPorDocumento(
    e.baixas,
    "pedido_compra_parcela_id",
    estornosPorBaixa,
  );
  const baixasDaAvulsa = agruparBaixasPorDocumento(
    e.baixas,
    "conta_avulsa_id",
    estornosPorBaixa,
  );
  const baixasDoDesembolso = agruparBaixasPorDocumento(
    e.baixas,
    "desembolso_parcela_id",
    estornosPorBaixa,
  );
  const baixasDaDevolucao = agruparBaixasPorDocumento(
    e.baixas,
    "pp_verba_devolucao_id",
    estornosPorBaixa,
  );
  const emRemessa = new Set(
    ((e.remessasItens ?? []) as Array<{ origem_id: string }>).map((i) => i.origem_id),
  );

  for (const l of (e.baixas ?? []) as unknown as Array<{
    id: string;
    conta_bancaria_id: string;
    pedido_compra_parcela_id: string | null;
    conta_avulsa_id: string | null;
    desembolso_parcela_id: string | null;
    pp_verba_devolucao_id: string | null;
    data_movimento: string;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
    conta: { nome: string | null; banco: string | null } | null;
    tipo: { codigo: string; nome: string } | null;
    subtipo: { nome: string } | null;
  }>) {
    const info: BaixaInfo = {
      lancamento_id: l.id,
      conta_id: l.conta_bancaria_id,
      pago_em: l.data_movimento,
      conta: l.conta?.nome
        ? `${l.conta.nome}${l.conta.banco ? ` · ${l.conta.banco}` : ""}`
        : "—",
      // Separados desde 08/09/2026. Juntos, o par saía como
      // "04 · Aluguel / Condomínio / IPTU" — o código do TIPO com o nome
      // do SUBTIPO —, e "Custo Fixo" não aparecia em lugar nenhum.
      centro: l.tipo ? `${l.tipo.codigo} · ${l.tipo.nome}` : "—",
      subtipo: l.subtipo?.nome ?? null,
      forma_pagamento: l.forma_pagamento,
      cartao_credito_id: l.cartao_credito_id,
    };
    if (l.pedido_compra_parcela_id) baixaPorParcela.set(l.pedido_compra_parcela_id, info);
    if (l.conta_avulsa_id) baixaPorAvulsa.set(l.conta_avulsa_id, info);
    if (l.desembolso_parcela_id) baixaPorDesembolsoParcela.set(l.desembolso_parcela_id, info);
    if (l.pp_verba_devolucao_id) baixaPorDevolucao.set(l.pp_verba_devolucao_id, info);
  }

  // PP sempre nasce vinculada a um job. Custo de job cai em "Custo
  // Operacional" (código 02) por convenção contábil — a UI usa esse id
  // como default do tipo na tela de baixa. O financeiro pode trocar.
  const custoOperacionalTipoId =
    (e.tipos ?? []).find((t) => t.codigo === "02")?.id ?? null;

  const titulos: TituloRow[] = [];

  for (const pp of e.pps) {
    // PP em avaliação ainda não é dinheiro a sair — vive só na aba de PPs.
    // Rejeitada e cancelada, idem.
    if (pp.status !== "aprovada" && pp.status !== "pago") continue;
    const total = pp.parcelas.length;
    for (const par of pp.parcelas) {
      const baixa = baixaPorParcela.get(par.id);
      titulos.push({
        id: par.id,
        origem: "pp",
        origem_label: pp.codigo,
        descricao: pp.servico,
        fornecedor_nome: pp.fornecedor_nome || "—",
        cadastro_do_fornecedor_mudou: pp.cadastro_do_fornecedor_mudou,
        job_codigo: pp.job_codigo || "—",
        job_nome: pp.job_nome,
        data_pagamento: par.data_pagamento,
        venc_original: par.data_vencimento,
        data_pagamento_primeira: par.data_pagamento_primeira,
        valor: par.valor,
        parcela_numero: par.numero,
        parcela_total: total,
        status: par.pago_em ? "pago" : "a_pagar",
        empresa_id: pp.empresa_id,
        // Desde 10/09/2026 o centro de custo está GRAVADO na PP: um
        // trigger carimba Custo Operacional em toda PP que nasce sem tipo
        // (`20260910200001_pp_nasce_em_custo_operacional`), porque toda PP
        // é custo de job. No cartão, a aprovação sobrescreve com o que o
        // financeiro escolheu. O `??` continua aqui como rede para as
        // linhas que porventura escapem — não é mais ele que decide, e o
        // subtipo segue vazio de propósito: quem escolhe é a baixa.
        plano_conta_tipo_id:
          pp.plano_conta_tipo_id ?? custoOperacionalTipoId,
        plano_conta_subtipo_id: pp.plano_conta_subtipo_id ?? null,
        pago_em: par.pago_em,
        conta_nome: baixa?.conta ?? null,
        centro_nome: baixa?.centro ?? null,
        subtipo_nome: baixa?.subtipo ?? null,
        baixa_lancamento_id: baixa?.lancamento_id ?? null,
        baixa_conta_id: baixa?.conta_id ?? null,
        estornos_da_baixa: baixa
          ? estornosPorBaixa.get(baixa.lancamento_id) ?? []
          : [],
        baixas: baixasDaParcela.get(par.id) ?? [],
        baixado: totalBaixado(baixasDaParcela.get(par.id) ?? []),
        em_remessa: emRemessa.has(par.id),
        eh_verba: pp.verba_producao,
        parte_id: pp.fornecedor_id || null,
        // A parcela roteada para o cartão carrega a forma da PP mesmo
        // antes de paga — é o que a faz aparecer na aba Cartão em vez de
        // Títulos a Pagar (29/08/2026). Fora do cartão continua como
        // antes: só a forma registrada na baixa.
        forma_pagamento: par.fatura_cartao_id
          ? "cartao_credito"
          : par.pago_em
            ? baixa?.forma_pagamento ?? null
            : null,
        // Na fatura, o cartão é o da BAIXA quando ela existe (decisão 093:
        // o financeiro pode trocar o cartão na hora de pagar); só a
        // parcela roteada antes da 093 fica com o da PP.
        cartao_credito_id: par.fatura_cartao_id
          ? baixa?.cartao_credito_id ?? pp.cartao_credito_id ?? null
          : par.pago_em
            ? baixa?.cartao_credito_id ?? null
            : null,
        forma_prevista: pp.forma_pagamento ?? null,
        cartao_previsto_id: pp.cartao_credito_id ?? null,
        fatura_cartao_id: par.fatura_cartao_id ?? null,
        // Nenhuma destas origens é estorno nem parcela de cartão: as duas
        // coisas só existem em compra de cartão, que vem do laço das
        // avulsas.
        // A urgência da PP segue no título (decisão 077, pergunta 4a).
        verba_situacao: situacaoDaVerba(pp),
        urgente: pp.urgente,
        urgente_justificativa: pp.urgente_justificativa,
        // Decisão 137: para onde mandar o dinheiro, e quem pediu, na baixa.
        fora_do_cadastro: pp.pagamento_fora_do_cadastro
          ? {
              pagamento: pp.pagamento_fora_do_cadastro,
              pedido: pedidoForaDoCadastro(pp.eventos),
            }
          : null,
        // Módulo fiscal: o `nf_numero` que o financeiro registrou na
        // aprovação (vem da `SELECT_PP_DO_FINANCEIRO`, em `nota_fiscal`).
        // Sem NF registrada — PP sem anexo de NF, verba, aprovada antes do
        // módulo —, null.
        nf_numero: pp.nota_fiscal?.registrada?.numero.trim() || null,
        estorno_de_avulsa_id: null,
        compra_id: "",
        compra_total: 0,
        estornado: 0,
      });
    }
  }

  for (const a of (e.avulsas ?? []) as unknown as Array<{
    id: string;
    descricao: string;
    valor: string | number;
    data_prevista_pagamento: string | null;
    data_pagamento: string | null;
    data_pagamento_primeira: string | null;
    status: "aprovada" | "baixada";
    pago_em: string | null;
    empresa_id: string;
    recorrente_id: string | null;
    folha_id: string | null;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
    fatura_cartao_id: string | null;
    estorno_de_avulsa_id: string | null;
    parcela_numero: number | null;
    parcela_total: number | null;
    parcela_de_avulsa_id: string | null;
    fornecedor_id: string | null;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
  }>) {
    const baixa = baixaPorAvulsa.get(a.id);
    titulos.push({
      id: a.id,
      origem: a.folha_id
        ? "folha"
        : a.recorrente_id
          ? "recorrencia"
          : "avulso",
      origem_label: a.folha_id
        ? "FOLHA"
        : a.recorrente_id
          ? "RECORRÊNCIA"
          : "AVULSO",
      // Sem foto de pagamento: o asterisco da 067 é só de PP.
      cadastro_do_fornecedor_mudou: false,
      descricao: a.descricao,
      fornecedor_nome: a.fornecedor?.razao_social ?? a.fornecedor?.nome ?? "—",
      // Avulsa e recorrência não têm job desde 15/09/2026 (decisão 069).
      job_codigo: "—",
      job_nome: "",
      data_pagamento: a.data_pagamento ?? a.data_prevista_pagamento,
      venc_original: a.data_prevista_pagamento,
      data_pagamento_primeira: a.data_pagamento_primeira,
      valor: Number(a.valor),
      parcela_numero: a.parcela_numero ?? 1,
      parcela_total: a.parcela_total ?? 1,
      status: a.status === "baixada" ? "pago" : "a_pagar",
      empresa_id: a.empresa_id,
      // Sugestão do centro de custo: o plano escolhido na criação.
      plano_conta_tipo_id: a.plano_conta_tipo_id,
      plano_conta_subtipo_id: a.plano_conta_subtipo_id,
      pago_em: a.pago_em,
      conta_nome: baixa?.conta ?? null,
      centro_nome: baixa?.centro ?? null,
      subtipo_nome: baixa?.subtipo ?? null,
      baixa_lancamento_id: baixa?.lancamento_id ?? null,
      baixa_conta_id: baixa?.conta_id ?? null,
      estornos_da_baixa: baixa
        ? estornosPorBaixa.get(baixa.lancamento_id) ?? []
        : [],
      baixas: baixasDaAvulsa.get(a.id) ?? [],
      baixado: totalBaixado(baixasDaAvulsa.get(a.id) ?? []),
      em_remessa: emRemessa.has(a.id),
      eh_verba: false,
      parte_id: a.fornecedor_id ?? null,
      // Se paga, prefere a forma registrada na baixa (realizado); senão,
      // usa a forma planejada da origem (avulsa/recorrência).
      // A avulsa "no cartão" só é da aba Cartão quando ESTÁ numa fatura —
      // paga, ou roteada antes da 093. A intenção do cadastro vai em
      // `forma_prevista` e pré-preenche a baixa, que é onde ela vira
      // fatura de verdade (decisão 093).
      forma_pagamento: a.pago_em
        ? baixa?.forma_pagamento ?? a.forma_pagamento
        : a.fatura_cartao_id
          ? "cartao_credito"
          : null,
      cartao_credito_id: a.pago_em
        ? baixa?.cartao_credito_id ?? a.cartao_credito_id
        : a.fatura_cartao_id
          ? a.cartao_credito_id
          : null,
      forma_prevista: a.forma_pagamento,
      cartao_previsto_id: a.cartao_credito_id,
      fatura_cartao_id: a.fatura_cartao_id,
      verba_situacao: null,
      urgente: false,
      urgente_justificativa: null,
      fora_do_cadastro: null,
      // NF do fornecedor registrada na aprovação: só PP tem.
      nf_numero: null,
      estorno_de_avulsa_id: a.estorno_de_avulsa_id,
      // A parcela do meio pertence à cabeça; a cabeça e a compra à vista
      // pertencem a si mesmas.
      compra_id: a.parcela_de_avulsa_id ?? a.id,
      // Os dois abaixo são preenchidos na passada seguinte: a parcela 3
      // pode aparecer antes da 1 nesta ordenação, e o estorno antes das
      // duas (29/08/2026).
      compra_total: 0,
      estornado: 0,
    });
  }

  // Total de cada compra e quanto dela já foi estornado. Uma passada só,
  // depois que todas as avulsas viraram linha.
  {
    const totalPorCompra = new Map<string, number>();
    const estornadoPorCompra = new Map<string, number>();

    for (const t of titulos) {
      if (
        t.origem !== "avulso" &&
        t.origem !== "recorrencia" &&
        t.origem !== "folha"
      )
        continue;
      if (t.estorno_de_avulsa_id) {
        estornadoPorCompra.set(
          t.estorno_de_avulsa_id,
          (estornadoPorCompra.get(t.estorno_de_avulsa_id) ?? 0) + t.valor,
        );
      } else {
        // Soma as parcelas na cabeça. À vista, soma em si mesma.
        totalPorCompra.set(
          t.compra_id,
          (totalPorCompra.get(t.compra_id) ?? 0) + t.valor,
        );
      }
    }

    for (const t of titulos) {
      if (
        t.origem !== "avulso" &&
        t.origem !== "recorrencia" &&
        t.origem !== "folha"
      )
        continue;
      t.compra_total = totalPorCompra.get(t.compra_id) ?? t.valor;
      t.estornado = estornadoPorCompra.get(t.compra_id) ?? 0;
    }
  }

  // 4º loop — parcelas de desembolso aprovado/pago viram títulos de origem `desembolso`.
  for (const des of (e.desembolsos ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    descricao: string;
    status: "aprovada" | "pago";
    empresa_id: string;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
    parcelas: Array<{
      id: string;
      numero: number;
      data_vencimento: string;
      data_pagamento: string | null;
      data_pagamento_primeira: string | null;
      valor: string | number;
      pago_em: string | null;
    }>;
  }>) {
    const total = des.parcelas.length;
    for (const par of des.parcelas) {
      const baixa = baixaPorDesembolsoParcela.get(par.id);
      titulos.push({
        id: par.id,
        origem: "desembolso",
        origem_label: des.codigo,
        // Sem foto de pagamento: o asterisco da 067 é só de PP.
        cadastro_do_fornecedor_mudou: false,
        descricao: des.descricao,
        fornecedor_nome: des.fornecedor?.razao_social ?? des.fornecedor?.nome ?? "—",
        // Desembolso não tem job desde 10/09/2026 (decisão 069).
        job_codigo: "—",
        job_nome: "",
        data_pagamento: par.data_pagamento,
        venc_original: par.data_vencimento,
        data_pagamento_primeira: par.data_pagamento_primeira,
        valor: Number(par.valor),
        parcela_numero: par.numero,
        parcela_total: total,
        status: par.pago_em ? "pago" : "a_pagar",
        empresa_id: des.empresa_id,
        // Desembolso é despesa sem job (decisão 069): o financeiro decide
        // o tipo na baixa.
        plano_conta_tipo_id: null,
        plano_conta_subtipo_id: null,
        pago_em: par.pago_em,
        conta_nome: baixa?.conta ?? null,
        centro_nome: baixa?.centro ?? null,
        subtipo_nome: baixa?.subtipo ?? null,
        baixa_lancamento_id: baixa?.lancamento_id ?? null,
        baixa_conta_id: baixa?.conta_id ?? null,
        estornos_da_baixa: baixa
          ? estornosPorBaixa.get(baixa.lancamento_id) ?? []
          : [],
        baixas: baixasDoDesembolso.get(par.id) ?? [],
        baixado: totalBaixado(baixasDoDesembolso.get(par.id) ?? []),
        em_remessa: emRemessa.has(par.id),
        eh_verba: false,
        parte_id: null,
        // Se paga, usa a forma registrada na baixa; senão, null (planejado
        // não existe para desembolso-parcela — Task 7 vai remover a coluna
        // do desembolso-pai).
        forma_pagamento: par.pago_em
          ? baixa?.forma_pagamento ?? null
          : null,
        cartao_credito_id: par.pago_em
          ? baixa?.cartao_credito_id ?? null
          : null,
        // A intenção registrada na aprovação (decisão 093, §12): pré-preenche
        // a baixa; a fatura só existe depois dela.
        forma_prevista: des.forma_pagamento ?? null,
        cartao_previsto_id: des.cartao_credito_id ?? null,
      fatura_cartao_id: null,
        // Nenhuma destas origens é estorno nem parcela de cartão: as duas
        // coisas só existem em compra de cartão, que vem do laço das
        // avulsas.
        verba_situacao: null,
        urgente: false,
        urgente_justificativa: null,
      fora_do_cadastro: null,
        // NF do fornecedor registrada na aprovação: só PP tem.
        nf_numero: null,
        estorno_de_avulsa_id: null,
        compra_id: "",
        compra_total: 0,
        estornado: 0,
      });
    }
  }

  // 5º loop — devoluções de verba de produção viram títulos de origem `pp_devolucao_verba`.
  for (const dev of (e.devolucoes ?? []) as unknown as Array<{
    id: string;
    tenant_id: string;
    empresa_id: string;
    valor: string | number;
    data_pagamento: string | null;
    data_pagamento_primeira: string | null;
    pago_em: string | null;
    pago_por: string | null;
    pp: {
      id: string;
      codigo: string;
      servico: string;
      job_id: string | null;
      plano_conta_tipo_id: string | null;
      plano_conta_subtipo_id: string | null;
      responsavel: { nome: string } | null;
      job: { id: string; codigo: string; nome: string } | null;
    } | null;
  }>) {
    const baixa = baixaPorDevolucao.get(dev.id);
    titulos.push({
      id: dev.id,
      origem: "pp_devolucao_verba",
      origem_label: `ESTORNO ${dev.pp?.codigo ?? ""}`,
      // A devolução é dinheiro VOLTANDO do responsável pela verba, não
      // pagamento a fornecedor — não há foto para comparar.
      cadastro_do_fornecedor_mudou: false,
      // "Estorno de verba" desde a decisão 081 (pergunta 6a). Nas telas ele
      // é despesa negativa; no banco segue positivo e, na baixa, entrada.
      descricao: `Estorno de verba ${dev.pp?.codigo ?? ""} — ${dev.pp?.servico ?? ""}`,
      fornecedor_nome: dev.pp?.responsavel?.nome
        ? `Verba — ${dev.pp.responsavel.nome}`
        : "",
      job_codigo: dev.pp?.job?.codigo ?? "—",
      job_nome: dev.pp?.job?.nome ?? "",
      data_pagamento: dev.data_pagamento,
      venc_original: dev.data_pagamento_primeira,
      data_pagamento_primeira: dev.data_pagamento_primeira,
      valor: Number(dev.valor),
      parcela_numero: 1,
      parcela_total: 1,
      status: dev.pago_em ? "pago" : "a_pagar",
      empresa_id: dev.empresa_id,
      // Já nasce no centro de custo da PP (decisão 081, 8a): o estorno abate
      // o mesmo custo que a verba lançou.
      plano_conta_tipo_id: dev.pp?.plano_conta_tipo_id ?? custoOperacionalTipoId,
      plano_conta_subtipo_id: dev.pp?.plano_conta_subtipo_id ?? null,
      pago_em: dev.pago_em,
      conta_nome: baixa?.conta ?? null,
      centro_nome: baixa?.centro ?? null,
      subtipo_nome: baixa?.subtipo ?? null,
      baixa_lancamento_id: baixa?.lancamento_id ?? null,
      baixa_conta_id: baixa?.conta_id ?? null,
      estornos_da_baixa: baixa
        ? estornosPorBaixa.get(baixa.lancamento_id) ?? []
        : [],
      baixas: baixasDaDevolucao.get(dev.id) ?? [],
      baixado: totalBaixado(baixasDaDevolucao.get(dev.id) ?? []),
      em_remessa: false,
      eh_verba: false,
      parte_id: null,
      forma_pagamento: dev.pago_em ? baixa?.forma_pagamento ?? null : null,
      cartao_credito_id: dev.pago_em ? baixa?.cartao_credito_id ?? null : null,
      forma_prevista: null,
      cartao_previsto_id: null,
      fatura_cartao_id: null,
      // Nenhuma destas origens é estorno nem parcela de cartão: as duas
      // coisas só existem em compra de cartão, que vem do laço das
      // avulsas.
      verba_situacao: null,
      urgente: false,
      urgente_justificativa: null,
      fora_do_cadastro: null,
      // NF do fornecedor registrada na aprovação: só PP tem.
      nf_numero: null,
      estorno_de_avulsa_id: null,
      compra_id: "",
      compra_total: 0,
      estornado: 0,
    });
  }

  // ISO vira dd/mm/aaaa aqui e não no cliente: esta string entra no título
  // que o financeiro lê na lista, e data ISO na tela é ruído.
  const dataBR = (iso: string) => {
    const [a, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
  };

  for (const f of (e.faturas ?? []) as any[]) {
    // Fatura credora — estorno maior que as compras do mês — não desce
    // para Títulos a Pagar: não há o que pagar. O crédito fica na conta
    // do cartão e abate a próxima fatura, que é o que a operadora faz
    // (29/08/2026).
    if (Number(f.valor_cobrado ?? 0) <= 0) continue;

    const cartaoNome = f.cartao?.nome ?? "Cartão";

    // Só a perna do BANCO: a do cartão é a contrapartida interna, e
    // mostrá-la na conferência diria "pago pela conta do próprio cartão".
    //
    // E só a baixa VIVA: uma fatura que já foi paga, estornada e paga de
    // novo guarda os dois pagamentos, e o `find` pegava o primeiro — a
    // conferência mostrava a data, a conta e o centro de custo da baixa
    // que já tinha sido desfeita (31/08/2026). Quem responde isso é a
    // `origem` da própria linha, no mesmo padrão dos outros cinco
    // documentos estornáveis: `fatura_cartao_baixa` está valendo,
    // `fatura_cartao_baixa_estornada` já foi desfeita (migration
    // 20260831150002).
    const pagoBanco = ((f.pagamentos ?? []) as any[]).find(
      (l: any) =>
        l.origem === "fatura_cartao_baixa" && !l.conta?.cartao_credito_id,
    );
    titulos.push({
      id: f.id,
      origem: "fatura_cartao",
      origem_label: f.codigo,
      // Quem recebe é o cartão, não o fornecedor — sem foto.
      cadastro_do_fornecedor_mudou: false,
      descricao: `Fatura ${cartaoNome} · fecha ${dataBR(f.competencia_fechamento)}`,
      fornecedor_nome: cartaoNome,
      job_codigo: "—",
      job_nome: "",
      data_pagamento: f.data_vencimento,
      venc_original: f.data_vencimento,
      data_pagamento_primeira: f.data_vencimento,
      valor: Number(f.valor_cobrado ?? 0),
      parcela_numero: 1,
      parcela_total: 1,
      status: f.status === "paga" ? "pago" : "a_pagar",
      empresa_id: f.cartao?.empresa_id ?? "",
      plano_conta_tipo_id: null,
      plano_conta_subtipo_id: null,
      pago_em: pagoBanco?.data_movimento ?? null,
      conta_nome: pagoBanco?.conta?.nome
        ? `${pagoBanco.conta.nome}${pagoBanco.conta.banco ? ` · ${pagoBanco.conta.banco}` : ""}`
        : null,
      centro_nome: pagoBanco?.tipo?.codigo
        ? `${pagoBanco.tipo.codigo} · ${pagoBanco.tipo.nome}`
        : null,
      subtipo_nome: pagoBanco?.subtipo?.nome ?? null,
      // Pagamento de fatura são duas pernas (banco e cartão) e não tem
      // estorno: cancelar vai pelo id da fatura (decisão 120).
      baixa_lancamento_id: null,
      baixa_conta_id: null,
      estornos_da_baixa: [],
      baixas: [],
      baixado: f.status === "paga" ? Number(f.valor_cobrado ?? 0) : 0,
      em_remessa: false,
      eh_verba: false,
      parte_id: null,
      // A fatura NÃO é um título "no cartão": ela é o que se paga PELO
      // banco. Sem isto ela cairia na aba Cartão junto com os itens dela.
      forma_pagamento: null,
      cartao_credito_id: null,
      forma_prevista: null,
      cartao_previsto_id: null,
      fatura_cartao_id: null,
      // Nenhuma destas origens é estorno nem parcela de cartão: as duas
      // coisas só existem em compra de cartão, que vem do laço das
      // avulsas.
      verba_situacao: null,
      urgente: false,
      urgente_justificativa: null,
      fora_do_cadastro: null,
      // NF do fornecedor registrada na aprovação: só PP tem.
      nf_numero: null,
      estorno_de_avulsa_id: null,
      compra_id: "",
      compra_total: 0,
      estornado: 0,
    });
  }

  return titulos;
}
