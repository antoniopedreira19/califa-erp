import { redirect } from "next/navigation";
import { FileText, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PedidosCompraList, type PPRow } from "./pedidos-compra-list";
import { ContasPagarTabs } from "./contas-pagar-tabs";
import { TitulosPagarList, type TituloRow } from "./titulos-pagar-list";
import { TitulosCartaoList } from "./titulos-cartao-list";
import type { FaturaDoCartao } from "./fechar-fatura-dialog";
import { RecorrentesList, type RecorrenteRow } from "./recorrentes-list";
import { DesembolsosContasPagarList, type DesembolsoRow } from "./desembolsos-list";
import type { PPStatus, PlanoContaTipo, PlanoContaSubtipo, ContaBancaria, FormaPagamento, BandeiraCartao, DesembolsoStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PedidosCompraFinanceiroPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const [
    { data, error },
    contasRes,
    tiposRes,
    subtiposRes,
    ppsPendentesCountRes,
    avulsasRes,
    baixasRes,
    empresasRes,
    fornecedoresRes,
    clientesRes,
    jobsRes,
    recorrentesRes,
    recorrentesAtivasCountRes,
    regionaisRes,
    cartoesRes,
    desembolsosRes,
    desembolsosTitulosRes,
    prestacoesRes,
    devolucoesRes,
  ] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select(
        `
        id, codigo, status, valor, quantidade, servico, especificacoes,
        prazo_pagamento, prazo_pagamento_financeiro, pdf_path, created_at,
        cancelada_em, motivo_cancelamento,
        rejeitada_em, motivo_rejeicao, pago_em, verba_producao,
        fornecedor:fornecedores(id, nome, razao_social),
        responsavel:profiles!responsavel_verba_id(id, nome),
        empresa:empresas(id, razao_social, nome_fantasia),
        cancelada_por_profile:profiles!cancelada_por(nome),
        emitida_por_profile:profiles!emitida_por(nome),
        rejeitada_por_profile:profiles!rejeitada_por(nome),
        pago_por_profile:profiles!pago_por(nome),
        job:jobs(
          id, codigo, nome, regional_id,
          projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))
        ),
        anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes),
        parcelas:pedidos_compra_parcelas(
          id, numero, data_vencimento, data_pagamento, data_pagamento_primeira,
          valor, pago_em
        )
      `,
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
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
    supabase
      .from("contas_avulsas")
      .select(`
        id, descricao, valor, natureza, data_prevista_pagamento,
        data_pagamento, data_pagamento_primeira, status,
        pago_em, created_at, empresa_id, recorrente_id,
        plano_conta_tipo_id, plano_conta_subtipo_id,
        forma_pagamento, cartao_credito_id,
        estorno_de_avulsa_id,
        fornecedor:fornecedores(nome, razao_social),
        job:jobs(codigo)
      `)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista_pagamento", { ascending: true })
      .order("created_at", { ascending: false }),
    // Baixas já realizadas — só o que a linha paga exibe no subtítulo
    // ("Pago em X · conta · centro de custo"). Sem embed pesado: três
    // nomes e nada mais.
    supabase
      .from("lancamentos_financeiros")
      .select(`
        pedido_compra_parcela_id, conta_avulsa_id, desembolso_parcela_id,
        pp_verba_devolucao_id, data_movimento,
        forma_pagamento, cartao_credito_id,
        conta:contas_bancarias(nome, banco),
        tipo:plano_contas_tipos(codigo),
        subtipo:plano_contas_subtipos(nome)
      `)
      .eq("tenant_id", session.activeTenant.id)
      .in("origem", ["pp_baixa", "avulsa_baixa", "desembolso_baixa", "pp_devolucao_verba"]),
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
      .select("id, nome, razao_social")
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
    // Jobs não cancelados — inclui cliente_id do projeto e regional_id do job
    // para auto-preencher cliente/rateio no drawer quando job é escolhido.
    supabase
      .from("jobs")
      .select("id, codigo, nome, regional_id, projeto:projetos!inner(cliente_id)")
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(500),
    // Recorrências (todos os status)
    supabase
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
      .order("proxima_data", { ascending: true }),
    // Contagem de recorrências ativas
    supabase
      .from("contas_avulsas_recorrentes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    // Regionais (para o editor de rateio no drawer da avulsa)
    supabase
      .from("regionais")
      .select("id, nome, ativo")
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
    supabase
      .from("desembolsos")
      .select(`
        id, codigo, descricao, valor, status,
        data_prevista_pagamento, motivo_rejeicao, motivo_cancelamento,
        aprovada_em, rejeitada_em, cancelada_em, pago_em, created_at,
        empresa:empresas(id, razao_social, nome_fantasia),
        fornecedor:fornecedores(id, nome, razao_social),
        criador:profiles!desembolsos_criado_por_fkey(nome)
      `)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    // Desembolsos para Títulos a Pagar — apenas aprovada|pago, com parcelas
    // embed. Query separada da de aprovação (Task 9) para não misturar filtros.
    supabase
      .from("desembolsos")
      .select(`
        id, codigo, descricao, status,
        empresa_id,
        fornecedor:fornecedores(nome, razao_social),
        job:jobs(codigo),
        parcelas:desembolsos_parcelas(
          id, numero, data_vencimento, data_pagamento, data_pagamento_primeira,
          valor, pago_em
        )
      `)
      .eq("tenant_id", session.activeTenant.id)
      .in("status", ["aprovada", "pago"])
      .order("created_at", { ascending: false }),
    // Prestações de contas de PPs de Verba de Produção (Task 6).
    supabase
      .from("pp_verba_prestacoes")
      .select(`
        id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_em,
        fechada_por_profile:profiles!fechada_por(nome),
        anexos:pp_verba_prestacoes_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes, arquivo_mimetype)
      `)
      .eq("tenant_id", session.activeTenant.id),
    // Devoluções de verba de produção — todas (a_pagar + pagas), para a
    // aba Títulos a Pagar (Task 11). Fetch direto na tabela, sem view.
    supabase
      .from("pp_verba_devolucoes")
      .select(`
        id, tenant_id, empresa_id, valor, data_pagamento, data_pagamento_primeira,
        pago_em, pago_por,
        pp:pedidos_compra!pedido_compra_id(id, codigo, servico, job_id,
          job:jobs(id, codigo, nome)
        )
      `)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (error) console.error("[financeiro.pp.list]", error.message);
  if (avulsasRes.error) console.error("[financeiro.avulsas.list]", avulsasRes.error.message);
  if (baixasRes.error) console.error("[financeiro.baixas.list]", baixasRes.error.message);
  if (recorrentesRes.error) console.error("[financeiro.recorrentes.list]", recorrentesRes.error.message);
  if (cartoesRes.error) console.error("[financeiro.cartoes.list]", cartoesRes.error.message);
  if (desembolsosRes.error) console.error("[financeiro.desembolsos.list]", desembolsosRes.error.message);
  if (desembolsosTitulosRes.error) console.error("[financeiro.desembolsos_titulos.list]", desembolsosTitulosRes.error.message);
  if (prestacoesRes.error) console.error("[financeiro.prestacoes.list]", prestacoesRes.error.message);
  if (devolucoesRes.error) console.error("[financeiro.devolucoes.list]", devolucoesRes.error.message);

  // Mapa pedido_compra_id → prestação (com anexos e profile de quem fechou)
  type PrestacaoComAnexos = {
    id: string;
    pedido_compra_id: string;
    valor_gasto: number;
    valor_devolvido: number;
    fechada_em: string;
    fechada_por_profile: { nome: string } | null;
    anexos: Array<{
      id: string;
      arquivo_nome_original: string;
      arquivo_tamanho_bytes: number;
      arquivo_mimetype: string;
    }>;
  };
  const prestacoesPorPP = new Map<string, PrestacaoComAnexos>();
  for (const p of (prestacoesRes.data ?? []) as unknown as PrestacaoComAnexos[]) {
    prestacoesPorPP.set(p.pedido_compra_id, p);
  }

  const rows: PPRow[] = ((data ?? []) as unknown as Array<{
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
    fornecedor: { id: string; nome: string; razao_social: string | null } | null;
    responsavel: { id: string; nome: string } | null;
    empresa: { id: string; razao_social: string; nome_fantasia: string | null } | null;
    cancelada_por_profile: { nome: string } | null;
    emitida_por_profile: { nome: string } | null;
    rejeitada_por_profile: { nome: string } | null;
    pago_por_profile: { nome: string } | null;
    job: {
      id: string;
      codigo: string;
      nome: string;
      regional_id: string | null;
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
    }>;
    parcelas: Array<{
      id: string;
      numero: number;
      data_vencimento: string;
      data_pagamento: string | null;
      data_pagamento_primeira: string | null;
      valor: string | number;
      pago_em: string | null;
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
    fornecedor_id: r.fornecedor?.id ?? "",
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? "",
    empresa_id: r.empresa?.id ?? "",
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    job_id: r.job?.id ?? "",
    job_codigo: r.job?.codigo ?? "",
    job_nome: r.job?.nome ?? "",
    regional_id: r.job?.regional_id ?? null,
    projeto_codigo: r.job?.projeto?.codigo ?? null,
    projeto_nome: r.job?.projeto?.nome ?? null,
    cliente_nome: r.job?.projeto?.cliente?.nome_fantasia ?? null,
    cancelada_por_nome: r.cancelada_por_profile?.nome ?? null,
    emitida_por_nome: r.emitida_por_profile?.nome ?? null,
    forma_pagamento: null,
    cartao_credito_id: null,
    verba_producao: r.verba_producao ?? false,
    responsavel_nome: r.responsavel?.nome ?? null,
    prestacao: prestacoesPorPP.get(r.id) ?? null,
    anexos: r.anexos ?? [],
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
      }))
      .sort((a, b) => a.numero - b.numero),
  }));

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
    pago_em: string;
    conta: string;
    centro: string;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
  };

  const baixaPorParcela = new Map<string, BaixaInfo>();
  const baixaPorAvulsa = new Map<string, BaixaInfo>();
  const baixaPorDesembolsoParcela = new Map<string, BaixaInfo>();
  const baixaPorDevolucao = new Map<string, BaixaInfo>();

  for (const l of (baixasRes.data ?? []) as unknown as Array<{
    pedido_compra_parcela_id: string | null;
    conta_avulsa_id: string | null;
    desembolso_parcela_id: string | null;
    pp_verba_devolucao_id: string | null;
    data_movimento: string;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
    conta: { nome: string | null; banco: string | null } | null;
    tipo: { codigo: string } | null;
    subtipo: { nome: string } | null;
  }>) {
    const info: BaixaInfo = {
      pago_em: l.data_movimento,
      conta: l.conta?.nome
        ? `${l.conta.nome}${l.conta.banco ? ` · ${l.conta.banco}` : ""}`
        : "—",
      centro:
        l.tipo?.codigo && l.subtipo?.nome
          ? `${l.tipo.codigo} · ${l.subtipo.nome}`
          : "—",
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
    (tiposRes.data ?? []).find((t) => t.codigo === "02")?.id ?? null;

  const titulos: TituloRow[] = [];

  for (const pp of rows) {
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
        job_codigo: pp.job_codigo || "—",
        data_pagamento: par.data_pagamento,
        venc_original: par.data_vencimento,
        data_pagamento_primeira: par.data_pagamento_primeira,
        valor: par.valor,
        parcela_numero: par.numero,
        parcela_total: total,
        status: par.pago_em ? "pago" : "a_pagar",
        empresa_id: pp.empresa_id,
        // PP sempre é custo de job → default Custo Operacional; subtipo
        // fica em branco pro financeiro escolher entre os do tipo.
        plano_conta_tipo_id: custoOperacionalTipoId,
        plano_conta_subtipo_id: null,
        pago_em: par.pago_em,
        conta_nome: baixa?.conta ?? null,
        centro_nome: baixa?.centro ?? null,
        // Se paga, usa a forma registrada na baixa; senão, null (planejado
        // não existe para PP — Task 7 vai remover a coluna da PP-pai).
        forma_pagamento: par.pago_em
          ? baixa?.forma_pagamento ?? null
          : null,
        cartao_credito_id: par.pago_em
          ? baixa?.cartao_credito_id ?? null
          : null,
        // Nenhuma destas origens é estorno: estorno só existe em compra
        // de cartão, que vem do laço das avulsas.
        estorno_de_avulsa_id: null,
        estornado: 0,
      });
    }
  }

  for (const a of (avulsasRes.data ?? []) as unknown as Array<{
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
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    forma_pagamento: FormaPagamento | null;
    cartao_credito_id: string | null;
    estorno_de_avulsa_id: string | null;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
    job: { codigo: string } | null;
  }>) {
    const baixa = baixaPorAvulsa.get(a.id);
    titulos.push({
      id: a.id,
      origem: a.recorrente_id ? "recorrencia" : "avulso",
      origem_label: a.recorrente_id ? "RECORRÊNCIA" : "AVULSO",
      descricao: a.descricao,
      fornecedor_nome: a.fornecedor?.razao_social ?? a.fornecedor?.nome ?? "—",
      job_codigo: a.job?.codigo ?? "—",
      data_pagamento: a.data_pagamento ?? a.data_prevista_pagamento,
      venc_original: a.data_prevista_pagamento,
      data_pagamento_primeira: a.data_pagamento_primeira,
      valor: Number(a.valor),
      parcela_numero: 1,
      parcela_total: 1,
      status: a.status === "baixada" ? "pago" : "a_pagar",
      empresa_id: a.empresa_id,
      // Sugestão do centro de custo: o plano escolhido na criação.
      plano_conta_tipo_id: a.plano_conta_tipo_id,
      plano_conta_subtipo_id: a.plano_conta_subtipo_id,
      pago_em: a.pago_em,
      conta_nome: baixa?.conta ?? null,
      centro_nome: baixa?.centro ?? null,
      // Se paga, prefere a forma registrada na baixa (realizado); senão,
      // usa a forma planejada da origem (avulsa/recorrência).
      forma_pagamento: a.pago_em
        ? baixa?.forma_pagamento ?? a.forma_pagamento
        : a.forma_pagamento,
      cartao_credito_id: a.pago_em
        ? baixa?.cartao_credito_id ?? a.cartao_credito_id
        : a.cartao_credito_id,
      estorno_de_avulsa_id: a.estorno_de_avulsa_id,
      // Preenchido logo abaixo, quando já existirem todas as linhas: o
      // estorno pode vir antes da compra nesta ordenação.
      estornado: 0,
    });
  }

  // Quanto de cada compra já foi estornado. Uma passada só, depois que
  // todas as avulsas viraram linha — o estorno pode aparecer antes da
  // compra na ordem por data (29/08/2026).
  {
    const estornadoPorCompra = new Map<string, number>();
    for (const t of titulos) {
      if (!t.estorno_de_avulsa_id) continue;
      estornadoPorCompra.set(
        t.estorno_de_avulsa_id,
        (estornadoPorCompra.get(t.estorno_de_avulsa_id) ?? 0) + t.valor,
      );
    }
    for (const t of titulos) {
      t.estornado = estornadoPorCompra.get(t.id) ?? 0;
    }
  }

  // 4º loop — parcelas de desembolso aprovado/pago viram títulos de origem `desembolso`.
  for (const des of (desembolsosTitulosRes.data ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    descricao: string;
    status: "aprovada" | "pago";
    empresa_id: string;
    fornecedor: { nome: string | null; razao_social: string | null } | null;
    job: { codigo: string } | null;
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
        descricao: des.descricao,
        fornecedor_nome: des.fornecedor?.razao_social ?? des.fornecedor?.nome ?? "—",
        job_codigo: des.job?.codigo ?? "—",
        data_pagamento: par.data_pagamento,
        venc_original: par.data_vencimento,
        data_pagamento_primeira: par.data_pagamento_primeira,
        valor: Number(par.valor),
        parcela_numero: par.numero,
        parcela_total: total,
        status: par.pago_em ? "pago" : "a_pagar",
        empresa_id: des.empresa_id,
        // Desembolso com job → default Custo Operacional. Sem job, o
        // financeiro decide o tipo na baixa.
        plano_conta_tipo_id: des.job ? custoOperacionalTipoId : null,
        plano_conta_subtipo_id: null,
        pago_em: par.pago_em,
        conta_nome: baixa?.conta ?? null,
        centro_nome: baixa?.centro ?? null,
        // Se paga, usa a forma registrada na baixa; senão, null (planejado
        // não existe para desembolso-parcela — Task 7 vai remover a coluna
        // do desembolso-pai).
        forma_pagamento: par.pago_em
          ? baixa?.forma_pagamento ?? null
          : null,
        cartao_credito_id: par.pago_em
          ? baixa?.cartao_credito_id ?? null
          : null,
        // Nenhuma destas origens é estorno: estorno só existe em compra
        // de cartão, que vem do laço das avulsas.
        estorno_de_avulsa_id: null,
        estornado: 0,
      });
    }
  }

  // 5º loop — devoluções de verba de produção viram títulos de origem `pp_devolucao_verba`.
  for (const dev of (devolucoesRes.data ?? []) as unknown as Array<{
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
      job: { id: string; codigo: string; nome: string } | null;
    } | null;
  }>) {
    const baixa = baixaPorDevolucao.get(dev.id);
    titulos.push({
      id: dev.id,
      origem: "pp_devolucao_verba",
      origem_label: `DEVOLUÇÃO ${dev.pp?.codigo ?? ""}`,
      descricao: `Devolução verba ${dev.pp?.codigo ?? ""} — ${dev.pp?.servico ?? ""}`,
      fornecedor_nome: "",
      job_codigo: dev.pp?.job?.codigo ?? "—",
      data_pagamento: dev.data_pagamento,
      venc_original: dev.data_pagamento_primeira,
      data_pagamento_primeira: dev.data_pagamento_primeira,
      valor: Number(dev.valor),
      parcela_numero: 1,
      parcela_total: 1,
      status: dev.pago_em ? "pago" : "a_pagar",
      empresa_id: dev.empresa_id,
      plano_conta_tipo_id: null,
      plano_conta_subtipo_id: null,
      pago_em: dev.pago_em,
      conta_nome: baixa?.conta ?? null,
      centro_nome: baixa?.centro ?? null,
      forma_pagamento: dev.pago_em ? baixa?.forma_pagamento ?? null : null,
      cartao_credito_id: dev.pago_em ? baixa?.cartao_credito_id ?? null : null,
      // Nenhuma destas origens é estorno: estorno só existe em compra
      // de cartão, que vem do laço das avulsas.
      estorno_de_avulsa_id: null,
      estornado: 0,
    });
  }

  // ---- Faturas ABERTAS, para o fechamento na aba Cartão ----
  //
  // A soma vem dos ITENS que apontam para a fatura, e não de uma coluna
  // guardada: enquanto a fatura está aberta o time ainda lança e remaneja,
  // e um total gravado envelheceria a cada mexida.
  const { data: faturasAbertasRes } = await supabase
    .from("faturas_cartao")
    .select(
      "id, codigo, cartao_credito_id, competencia_fechamento, data_vencimento, " +
        "status, valor_cobrado, itens:contas_avulsas(valor, status, natureza)",
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
    // Na aberta os itens estão em "aprovada"; na fechada eles já viraram
    // lançamento e foram para "baixada". Contar só os aprovados na
    // fechada daria zero itens e zero reais.
    const fechada = f.status === "fechada";
    const itens = fechada
      ? todos
      : todos.filter((i) => i.status === "aprovada");
    return {
      id: f.id,
      codigo: f.codigo,
      cartao_credito_id: f.cartao_credito_id,
      competencia_fechamento: f.competencia_fechamento,
      data_vencimento: f.data_vencimento,
      // Com sinal: o estorno é 'entrada' e ABATE a fatura. Somar tudo
      // como positivo inflaria o total e faria o fechamento pedir um
      // ajuste que não existe (29/08/2026). Na fechada quem manda é o
      // valor cobrado, que já embute o ajuste.
      soma_itens: fechada
        ? Number(f.valor_cobrado ?? 0)
        : itens.reduce(
            (s, i) =>
              s +
              (i.natureza === "entrada"
                ? -Number(i.valor ?? 0)
                : Number(i.valor ?? 0)),
            0,
          ),
      qtd_itens: itens.length,
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
    .select(
      "id, codigo, competencia_fechamento, data_vencimento, status, valor_cobrado, " +
        "cartao:cartoes_credito!inner(nome, ultimos_4_digitos, empresa_id), " +
        // A perna bancária do pagamento: é dela que saem "Pago em",
        // "Conta" e "Centro de custo" na conferência da baixa. Sem isso a
        // fatura paga abria com três travessões (29/08/2026). O filtro
        // por papel evita pegar o lançamento do cartão ou o do estorno.
        "pagamentos:lancamentos_financeiros!fatura_cartao_id(" +
        "data_movimento, papel_na_fatura, " +
        "conta:contas_bancarias(nome, banco, cartao_credito_id), " +
        "tipo:plano_contas_tipos(codigo), subtipo:plano_contas_subtipos(nome))",
    )
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["fechada", "paga"]);

  if (faturasErr) {
    console.error("[contas-a-pagar.faturas-cartao]", faturasErr.message);
  }

  // ISO vira dd/mm/aaaa aqui e não no cliente: esta string entra no título
  // que o financeiro lê na lista, e data ISO na tela é ruído.
  const dataBR = (iso: string) => {
    const [a, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
  };

  for (const f of (faturasRes ?? []) as any[]) {
    // Fatura credora — estorno maior que as compras do mês — não desce
    // para Títulos a Pagar: não há o que pagar. O crédito fica na conta
    // do cartão e abate a próxima fatura, que é o que a operadora faz
    // (29/08/2026).
    if (Number(f.valor_cobrado ?? 0) <= 0) continue;

    const cartaoNome = f.cartao?.nome ?? "Cartão";

    // Só a perna do BANCO: a do cartão é a contrapartida interna, e
    // mostrá-la na conferência diria "pago pela conta do próprio cartão".
    const pagoBanco = (f.pagamentos ?? []).find(
      (l: any) =>
        l.papel_na_fatura === "pagamento" && !l.conta?.cartao_credito_id,
    );
    titulos.push({
      id: f.id,
      origem: "fatura_cartao",
      origem_label: f.codigo,
      descricao: `Fatura ${cartaoNome} · fecha ${dataBR(f.competencia_fechamento)}`,
      fornecedor_nome: cartaoNome,
      job_codigo: "—",
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
      centro_nome:
        pagoBanco?.tipo?.codigo && pagoBanco?.subtipo?.nome
          ? `${pagoBanco.tipo.codigo} · ${pagoBanco.subtipo.nome}`
          : null,
      // A fatura NÃO é um título "no cartão": ela é o que se paga PELO
      // banco. Sem isto ela cairia na aba Cartão junto com os itens dela.
      forma_pagamento: null,
      cartao_credito_id: null,
      // Nenhuma destas origens é estorno: estorno só existe em compra
      // de cartão, que vem do laço das avulsas.
      estorno_de_avulsa_id: null,
      estornado: 0,
    });
  }

  // Aba "Cartão" — TODOS os títulos de cartão (a pagar + pagos). O filtro
  // de status é interno na lista, padrão "a pagar".
  const titulosCartao = titulos.filter(
    (t) => t.forma_pagamento === "cartao_credito",
  );
  // Badge da aba: só os "a pagar" (o padrão do filtro).
  const titulosCartaoCount = titulosCartao.filter((t) => t.status === "a_pagar").length;

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
  const fornecedoresList = (fornecedoresRes.data ?? []).map((f: { id: string; nome: string; razao_social: string | null }) => ({
    id: f.id,
    nome: f.razao_social ?? f.nome,
  }));
  const clientesList = (clientesRes.data ?? []).map((c: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
    id: c.id,
    nome: c.razao_social ?? c.nome_fantasia ?? "",
  }));
  const jobsList = (jobsRes.data ?? []).map(
    (j: {
      id: string;
      codigo: string;
      nome: string;
      regional_id: string | null;
      projeto: { cliente_id: string } | { cliente_id: string }[] | null;
    }) => {
      // PostgREST embed self-referencial pode vir como array — normaliza.
      const proj = Array.isArray(j.projeto) ? j.projeto[0] : j.projeto;
      return {
        id: j.id,
        codigo: j.codigo,
        nome: j.nome,
        cliente_id: proj?.cliente_id ?? null,
        regional_id: j.regional_id ?? null,
      };
    },
  );

  const regionaisList = (regionaisRes.data ?? []).map(
    (r: { id: string; nome: string; ativo: boolean }) => ({
      id: r.id,
      nome: r.nome,
      ativo: r.ativo,
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

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Contas a Pagar</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FileText className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Contas a Pagar</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          Pedidos de Produção, títulos a pagar e recorrências que envolvem
          dinheiro a sair. Aprove e rejeite os PPs; dê baixa nos títulos para
          enviá-los à conciliação.
        </p>
      </header>

      <ContasPagarTabs
        pps={<PedidosCompraList rows={rows} tenantId={session.activeTenant.id} regionais={regionaisList} />}
        ppsPendentesCount={ppsPendentesCountRes.count ?? 0}
        desembolsos={<DesembolsosContasPagarList rows={desembolsosRows} />}
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
            jobs={jobsList}
            regionais={regionaisList}
            cartoes={cartoesList}
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
            jobs={jobsList}
            regionais={regionaisList}
            cartoes={cartoesList}
          />
        }
        recorrentesAtivasCount={recorrentesAtivasCountRes.count ?? 0}
        titulosCartao={
          <TitulosCartaoList
            rows={titulosCartao}
            cartoes={cartoesList}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            tenantId={session.activeTenant.id}
            empresas={empresasList}
            fornecedores={fornecedoresList}
            clientes={clientesList}
            jobs={jobsList}
            regionais={regionaisList}
            faturasDoCartao={faturasDoCartao}
          />
        }
        titulosCartaoCount={titulosCartaoCount}
      />
    </div>
  );
}
