import {
  AlertTriangle,
  BadgeDollarSign,
  Banknote,
  Briefcase,
  CalendarClock,
  Clock,
  CreditCard,
  FileClock,
  FileText,
  Landmark,
  Mail,
  MessageSquare,
  Receipt,
  Wallet,
} from "lucide-react";
import type { SessionContext } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import {
  impedimentosDosJobs,
  podeEncerrar,
} from "@/lib/data/impedimentos-encerramento";
import type { CardKpi, CardPendencia, DadosHome } from "./tipos";
import { projetoIdsDoUsuario } from "./escopo-meus";

const formatarBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Data ISO 'YYYY-MM-DD' do primeiro e ultimo dia do mes corrente. */
function limitesDoMes(): { primeiro: string; ultimo: string } {
  const hoje = new Date();
  const p = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const u = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { primeiro: iso(p), ultimo: iso(u) };
}

const hojeISO = () => new Date().toISOString().slice(0, 10);

function diasNoFuturo(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Subtítulo do card da fila de abertura: com save a aprovar, diz quantos
 * são jobs e quantos são saves; sem, fica o texto de sempre (24/09/2026).
 */
function subtituloDaFila(jobs: number, saves: number, padrao: string): string {
  if (saves === 0) return padrao;
  const j = `${jobs} ${jobs === 1 ? "job" : "jobs"} para abrir`;
  const sv = `${saves} ${saves === 1 ? "save" : "saves"} a aprovar`;
  return jobs === 0 ? sv : `${j} · ${sv}`;
}

/**
 * Home do Administrador: ve o tenant inteiro. Cards de pendencia e KPIs
 * do mes corrente. Todas as contagens em Promise.all — nenhuma query
 * bloqueia a proxima.
 *
 * Substituicoes do adendo (schema real):
 * - titulos_a_pagar → vw_a_pagar (data_prevista, sem data_pagamento)
 * - titulos_a_receber → titulos_receber (data_previsao_recebimento, pago_em)
 * - contas_bancarias.saldo_atual → saldo_inicial (aproximacao V1)
 * - jobs.status inclui "em_producao" (enum existe — ruling anterior errou)
 * - orcamentos.status "enviado_cliente" EXISTE no enum (ruling anterior errou)
 * - Card "Transacoes nao conciliadas" removido (tabela nao existe)
 * Total: 7 pendencias (ADM), 6 (Financeiro)
 */
export async function carregarHomeAdmin(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = await createClient();
  const tenantId = session.activeTenant.id;
  const { primeiro, ultimo } = limitesDoMes();
  const hoje = hojeISO();
  const ha15dias = diasNoFuturo(-15);

  const [
    contasPagarVencidas,
    contasReceberVencidas,
    jobsAguardandoAbertura,
    savesAguardando,
    ppsEmAvaliacao,
    desembolsosEmAvaliacao,
    jobsPendentesDeEnvio,
    orcamentosParados,
    saldoBancosRes,
    previstoPagarMes,
    previstoReceberMes,
    jobsEmAndamento,
  ] = await Promise.all([
    // vw_a_pagar ja filtra pagas internamente; vencidas = data_prevista < hoje
    supabase
      .from("vw_a_pagar")
      .select("origem_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_prevista", hoje),
    // titulos_receber: vencidas = data_previsao_recebimento < hoje AND pago_em IS NULL
    supabase
      .from("titulos_receber")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_previsao_recebimento", hoje)
      .is("pago_em", null),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "aguardando_abertura"),
    // Saves a aprovar (decisão 099): a fila da abertura pede os dois ao
    // financeiro, e o card conta os dois, como a aba da fila (24/09/2026).
    supabase
      .from("saves_aprovacoes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("situacao", "aguardando"),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    supabase
      .from("desembolsos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    // Jobs pendentes de envio para faturamento, da empresa inteira (decisão
    // 105): o administrador acompanha tudo. Era "Jobs com faturamento
    // próximo", pela data prevista — que não é uma data planejada de verdade.
    pendentesDeEnvioQuery(supabase, tenantId),
    // orcamentos parados: "em_revisao" + "enviado_cliente" (enum real)
    // rascunho = editing normal, nao abandono; por isso excluido
    supabase
      .from("orcamentos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["em_revisao", "enviado_cliente"])
      .lt("updated_at", ha15dias),
    // saldo_inicial como aproximacao (adendo §3)
    // TODO: virar RPC de saldo_atual quando o modulo de conciliacao existir
    supabase
      .from("contas_bancarias")
      .select("saldo_inicial")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    // vw_a_pagar: previsto a pagar do mes (adendo §1)
    supabase
      .from("vw_a_pagar")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_prevista", primeiro)
      .lte("data_prevista", ultimo),
    // titulos_receber: previsto a receber do mes (adendo §2)
    supabase
      .from("titulos_receber")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_previsao_recebimento", primeiro)
      .lte("data_previsao_recebimento", ultimo)
      .is("pago_em", null),
    // jobs em andamento: "aberto" + "em_producao" (enum real)
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["aberto", "em_producao"]),
  ]);

  const saldoBancosTotal = (saldoBancosRes.data ?? []).reduce(
    (s, r) => s + Number(r.saldo_inicial ?? 0),
    0,
  );
  const totalAPagar = (previstoPagarMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );
  const totalAReceber = (previstoReceberMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );

  // 7 pendencias (card "Transacoes nao conciliadas" removido — adendo §4)
  const pendencias: CardPendencia[] = [
    {
      titulo: "Contas a pagar vencidas",
      contagem: contasPagarVencidas.count ?? 0,
      subtitulo: "Não pagas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-pagar?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Contas a receber vencidas",
      contagem: contasReceberVencidas.count ?? 0,
      subtitulo: "Não recebidas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-receber?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Jobs aguardando abertura",
      contagem: (jobsAguardandoAbertura.count ?? 0) + (savesAguardando.count ?? 0),
      subtitulo: subtituloDaFila(
        jobsAguardandoAbertura.count ?? 0,
        savesAguardando.count ?? 0,
        "Fila do financeiro pra abrir jobs",
      ),
      href: "/financeiro/abertura-de-job",
      icone: Briefcase,
    },
    {
      titulo: "PPs em avaliação",
      contagem: ppsEmAvaliacao.count ?? 0,
      subtitulo: "Aguardando decisão do financeiro",
      href: "/financeiro/contas-a-pagar?filtro=pps_em_avaliacao",
      icone: FileClock,
    },
    {
      titulo: "Desembolsos em avaliação",
      contagem: desembolsosEmAvaliacao.count ?? 0,
      subtitulo: "Solicitações aguardando aprovação",
      href: "/financeiro/desembolsos?filtro=avaliacao",
      icone: Wallet,
    },
    {
      titulo: "Jobs pendentes de envio para faturamento",
      contagem: jobsPendentesDeEnvio.count ?? 0,
      subtitulo: "Com faturamento previsto e ainda não enviados",
      href: "/jobs?filtro=faturamento_pendente",
      icone: CalendarClock,
    },
    {
      titulo: "Orçamentos parados há mais de 15 dias",
      contagem: orcamentosParados.count ?? 0,
      subtitulo: "Sem movimentação desde então",
      href: "/orcamentos?filtro=parados",
      icone: Clock,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Saldo em bancos",
      valor: formatarBRL(saldoBancosTotal),
      subtitulo: "Hoje",
      href: "/financeiro/fluxo-caixa",
      icone: Landmark,
    },
    {
      titulo: "Previsto a pagar",
      valor: formatarBRL(totalAPagar),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-pagar",
      icone: Banknote,
    },
    {
      titulo: "Previsto a receber",
      valor: formatarBRL(totalAReceber),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-receber",
      icone: BadgeDollarSign,
    },
    {
      titulo: "Jobs em andamento",
      valor: String(jobsEmAndamento.count ?? 0),
      subtitulo: "Em andamento",
      href: "/jobs",
      icone: Briefcase,
    },
  ];

  return { pendencias, kpis };
}

/**
 * Home do Financeiro: mesma visao de tenant do ADM, mas KPIs diferentes
 * e um card extra de faturas de cartao (nao aparece pro ADM porque nao
 * cabia na visao executiva).
 *
 * 6 pendencias (card "Transacoes nao conciliadas" removido — adendo §4).
 */
export async function carregarHomeFinanceiro(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = await createClient();
  const tenantId = session.activeTenant.id;
  const { primeiro, ultimo } = limitesDoMes();
  const hoje = hojeISO();

  const [
    contasPagarVencidas,
    contasReceberVencidas,
    jobsAguardandoAbertura,
    savesAguardando,
    ppsEmAvaliacao,
    desembolsosEmAvaliacao,
    faturasCartaoFechadas,
    saldoBancosRes,
    previstoPagarMes,
    previstoReceberMes,
  ] = await Promise.all([
    // vw_a_pagar: vencidas (adendo §1)
    supabase
      .from("vw_a_pagar")
      .select("origem_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_prevista", hoje),
    // titulos_receber: vencidas (adendo §2)
    supabase
      .from("titulos_receber")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .lt("data_previsao_recebimento", hoje)
      .is("pago_em", null),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "aguardando_abertura"),
    // Saves a aprovar (decisão 099): a fila da abertura pede os dois ao
    // financeiro, e o card conta os dois, como a aba da fila (24/09/2026).
    supabase
      .from("saves_aprovacoes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("situacao", "aguardando"),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    supabase
      .from("desembolsos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_avaliacao"),
    // faturas_cartao: status "fechada" = aguardando pagamento (adendo §9)
    // sem .is("data_pagamento", null) — coluna nao existe
    supabase
      .from("faturas_cartao")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "fechada"),
    // saldo_inicial como aproximacao (adendo §3)
    // TODO: virar RPC de saldo_atual quando o modulo de conciliacao existir
    supabase
      .from("contas_bancarias")
      .select("saldo_inicial")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    // vw_a_pagar: previsto a pagar do mes (adendo §1)
    supabase
      .from("vw_a_pagar")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_prevista", primeiro)
      .lte("data_prevista", ultimo),
    // titulos_receber: previsto a receber do mes (adendo §2)
    supabase
      .from("titulos_receber")
      .select("valor")
      .eq("tenant_id", tenantId)
      .gte("data_previsao_recebimento", primeiro)
      .lte("data_previsao_recebimento", ultimo)
      .is("pago_em", null),
  ]);

  const saldoTotal = (saldoBancosRes.data ?? []).reduce(
    (s, r) => s + Number(r.saldo_inicial ?? 0),
    0,
  );
  const totalPagar = (previstoPagarMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );
  const totalReceber = (previstoReceberMes.data ?? []).reduce(
    (s, r) => s + Number(r.valor ?? 0),
    0,
  );

  // 6 pendencias (card "Transacoes nao conciliadas" removido — adendo §4)
  const pendencias: CardPendencia[] = [
    {
      titulo: "Contas a pagar vencidas",
      contagem: contasPagarVencidas.count ?? 0,
      subtitulo: "Não pagas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-pagar?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Contas a receber vencidas",
      contagem: contasReceberVencidas.count ?? 0,
      subtitulo: "Não recebidas com vencimento anterior a hoje",
      href: "/financeiro/contas-a-receber?filtro=vencidas",
      icone: AlertTriangle,
    },
    {
      titulo: "Jobs aguardando abertura",
      contagem: (jobsAguardandoAbertura.count ?? 0) + (savesAguardando.count ?? 0),
      subtitulo: subtituloDaFila(
        jobsAguardandoAbertura.count ?? 0,
        savesAguardando.count ?? 0,
        "Sua fila principal",
      ),
      href: "/financeiro/abertura-de-job",
      icone: Briefcase,
    },
    {
      titulo: "PPs em avaliação",
      contagem: ppsEmAvaliacao.count ?? 0,
      subtitulo: "Aguardando sua decisão",
      href: "/financeiro/contas-a-pagar?filtro=pps_em_avaliacao",
      icone: FileClock,
    },
    {
      titulo: "Desembolsos em avaliação",
      contagem: desembolsosEmAvaliacao.count ?? 0,
      subtitulo: "Solicitações aguardando aprovação",
      href: "/financeiro/desembolsos?filtro=avaliacao",
      icone: Wallet,
    },
    {
      titulo: "Faturas de cartão aguardando pagamento",
      contagem: faturasCartaoFechadas.count ?? 0,
      subtitulo: "Fatura fechada, sem pagamento registrado",
      href: "/financeiro/contas-a-pagar?filtro=faturas_cartao",
      icone: CreditCard,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Saldo em bancos",
      valor: formatarBRL(saldoTotal),
      subtitulo: "Hoje",
      href: "/financeiro/fluxo-caixa",
      icone: Landmark,
    },
    {
      titulo: "Previsto a pagar",
      valor: formatarBRL(totalPagar),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-pagar",
      icone: Banknote,
    },
    {
      titulo: "Previsto a receber",
      valor: formatarBRL(totalReceber),
      subtitulo: "No mês corrente",
      href: "/financeiro/contas-a-receber",
      icone: BadgeDollarSign,
    },
  ];

  return { pendencias, kpis };
}

/**
 * Home do Freelancer: o RLS ja restringe tudo aos projetos onde ele
 * participa (via projeto_responsaveis), entao as queries aqui NAO
 * precisam de filtro adicional de projeto_id.
 *
 * Substituicoes do adendo:
 * - jobs.status inclui "em_producao" (enum real — ruling anterior errou)
 * - jobs_itens_realizado.valor_total_realizado → total_realizado (adendo §8)
 */
export async function carregarHomeFreelancer(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = await createClient();
  const tenantId = session.activeTenant.id;

  const [meusJobsAtivos, realizadoPendente, mensagensNaoLidas] =
    await Promise.all([
      // jobs ativos: "aberto" + "em_producao" (enum real)
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .in("status", ["aberto", "em_producao"]),
      // jobs_itens_realizado.total_realizado (adendo §8)
      supabase
        .from("jobs_itens_realizado")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("total_realizado", null),
      // TODO: migrar pra join com jobs_chat_leituras pra contar so "nao lidas" de verdade
      supabase
        .from("jobs_mensagens")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .neq("autor_id", session.profile.id),
    ]);

  const pendencias: CardPendencia[] = [
    {
      titulo: "Realizado a preencher",
      contagem: realizadoPendente.count ?? 0,
      subtitulo: "Itens dos seus jobs sem valor registrado",
      href: "/jobs?filtro=realizado_pendente",
      icone: FileText,
    },
    {
      titulo: "Mensagens no chat",
      contagem: mensagensNaoLidas.count ?? 0,
      subtitulo: "Nos jobs em que você participa",
      href: "/jobs?filtro=chat_pendente",
      icone: MessageSquare,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Meus jobs ativos",
      valor: String(meusJobsAtivos.count ?? 0),
      subtitulo: "Em andamento",
      href: "/jobs",
      icone: Briefcase,
    },
  ];

  return { pendencias, kpis };
}

/**
 * Home do Gerente de Producao.
 *
 * Cards de ACAO usam filtro estrito (a acao so pode ser executada por
 * quem e responsavel direto): versoes onde `orcamento.gp_responsavel_id`
 * bate, jobs onde `responsavel_id` bate.
 *
 * Cards de CONTEXTO usam o escopo expandido via `projetoIdsDoUsuario`.
 *
 * Notas de schema real (enum completo verificado):
 * - versoes_orcamento.status: "enviada_cliente" EXISTE no enum
 * - jobs_envio_faturamento: sem coluna status → presenca do registro basta (!inner)
 * - jobs.status: "em_producao" EXISTE no enum
 * - orcamentos.status: "enviado_cliente" EXISTE no enum
 */
export async function carregarHomeGerenteProducao(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = await createClient();
  const tenantId = session.activeTenant.id;
  const userId = session.profile.id;

  // Escopo expandido: rodado uma vez, reusado nos cards de contexto.
  const projetoIds = await projetoIdsDoUsuario(session, supabase);
  const semProjetos = projetoIds.length === 0;

  const [
    versoesAguardandoMim,
    meusJobsAbertos,
    meusPendentesDeEnvio,
    mensagensNaoLidas,
    meusJobsAndamento,
    meusOrcamentosAbertos,
  ] = await Promise.all([
    // ESTRITO: versoes aguardando revisao ou enviadas ao cliente, onde eu sou o GP
    // "enviada_cliente" EXISTE no enum — incluido agora
    supabase
      .from("versoes_orcamento")
      // `!orcamento_id`: há duas FKs entre `versoes_orcamento` e
      // `orcamentos` (a `orcamento_id` e a `orcamentos.versao_aprovada_id`).
      // Sem a dica o PostgREST responde 300 por ambiguidade e o card
      // contava nada (corrigido em 14/09/2026).
      .select("id, orcamento:orcamentos!orcamento_id!inner(gp_responsavel_id)", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", tenantId)
      .in("status", ["em_revisao", "enviada_cliente"])
      .eq("orcamento.gp_responsavel_id", userId),
    // ESTRITO: meus jobs abertos — base do "prontos pra encerrar", que
    // confere as pendências numa segunda onda (`contarProntosPraEncerrar`).
    supabase
      .from("jobs")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("responsavel_id", userId)
      .in("status", ["aberto", "em_producao"]),
    // ESTRITO: meus jobs pendentes de envio para faturamento (decisão 105).
    // Um card só no lugar de "prontos pra enviar pra faturamento" e de
    // "faturamento próximo" (pedido do Tiago, 25/09/2026). "Meus" é o da
    // lista de jobs: sou o GP responsável (decisão 036).
    pendentesDeEnvioQuery(supabase, tenantId, userId),
    // CONTEXTO: mensagens no chat dos jobs onde participo
    // TODO: migrar pra join com jobs_chat_leituras pra contar so "nao lidas" de verdade
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs_mensagens")
          .select("id, job:jobs!inner(projeto_id)", {
            count: "exact",
            head: true,
          })
          .eq("tenant_id", tenantId)
          .in("job.projeto_id", projetoIds)
          .neq("autor_id", userId),
    // CONTEXTO KPI: jobs em andamento nos meus projetos
    // "aberto" + "em_producao" (enum real)
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("projeto_id", projetoIds)
          .in("status", ["aberto", "em_producao"]),
    // CONTEXTO KPI: orcamentos abertos nos meus projetos
    // "enviado_cliente" EXISTE no enum — incluido agora
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("orcamentos")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("projeto_id", projetoIds)
          .in("status", ["rascunho", "em_revisao", "enviado_cliente"]),
  ]);

  const prontosPraEncerrar = await contarProntosPraEncerrar(
    supabase,
    tenantId,
    meusJobsAbertos,
  );

  const pendencias: CardPendencia[] = [
    {
      titulo: "Versões aguardando sua aprovação",
      contagem: versoesAguardandoMim.count ?? 0,
      subtitulo: "Orçamentos onde você é o GP responsável",
      href: "/orcamentos?filtro=aguardando_aprovacao&meus=1",
      icone: FileClock,
    },
    {
      titulo: "Jobs pendentes de envio para faturamento",
      contagem: meusPendentesDeEnvio.count ?? 0,
      subtitulo: "Seus jobs com faturamento previsto e ainda não enviados",
      href: "/jobs?filtro=faturamento_pendente&meus=1",
      icone: Mail,
    },
    {
      titulo: "Jobs prontos pra encerrar",
      contagem: prontosPraEncerrar,
      subtitulo: "Seus jobs abertos sem nenhuma pendência de produção",
      href: "/jobs?filtro=encerrar_pronto&meus=1",
      icone: Receipt,
    },
    {
      titulo: "Mensagens no chat",
      contagem: mensagensNaoLidas.count ?? 0,
      subtitulo: "Chat dos jobs em que você participa",
      href: "/jobs?filtro=chat_pendente&meus=1",
      icone: MessageSquare,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Meus jobs em andamento",
      valor: String(meusJobsAndamento.count ?? 0),
      subtitulo: "Time inteiro, aberto ou em produção",
      href: "/jobs?meus=1",
      icone: Briefcase,
    },
    {
      titulo: "Meus orçamentos abertos",
      valor: String(meusOrcamentosAbertos.count ?? 0),
      subtitulo: "Rascunho, em revisão ou enviado ao cliente",
      href: "/orcamentos?meus=1",
      icone: FileText,
    },
  ];

  return { pendencias, kpis };
}

/**
 * Home do Produtor. Cards de acao sobre coisas dele (PPs que ele emitiu,
 * jobs sob sua responsabilidade); contexto no time.
 *
 * Notas de schema real (enum completo verificado):
 * - jobs_itens_realizado.valor_total_realizado → total_realizado (adendo §7)
 * - jobs.status inclui "em_producao" (enum real — ruling anterior errou)
 * - pedidos_compra.emitida_em nao existe → usar created_at (adendo §9)
 */
export async function carregarHomeProdutor(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = await createClient();
  const tenantId = session.activeTenant.id;
  const userId = session.profile.id;
  const { primeiro, ultimo } = limitesDoMes();

  const projetoIds = await projetoIdsDoUsuario(session, supabase);
  const semProjetos = projetoIds.length === 0;

  const [
    ppsRejeitadas,
    realizadoPendente,
    mensagensNaoLidas,
    meusJobsAndamento,
    ppsEmitidasMes,
  ] = await Promise.all([
    // ESTRITO: PPs que EU emiti e foram rejeitadas
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("emitida_por", userId)
      .eq("status", "rejeitada"),
    // ESTRITO: itens sem valor realizado em jobs onde sou responsavel ou produtor
    // Adendo §7: "valor_total_realizado" nao existe → "total_realizado"
    // CRITICAL fix: .or() em coluna de embed EXIGE referencedTable; sem isso PostgREST
    // tenta match top-level e retorna zero silenciosamente.
    // "em_producao" EXISTE no enum — incluido (realizado tambem acontece em producao)
    supabase
      .from("jobs_itens_realizado")
      .select("id, job:jobs!inner(responsavel_id, produtor_id, status)", {
        count: "exact",
        head: true,
      })
      .eq("tenant_id", tenantId)
      .is("total_realizado", null)
      .in("job.status", ["aberto", "em_producao"])
      .or(`responsavel_id.eq.${userId},produtor_id.eq.${userId}`, {
        referencedTable: "job",
      }),
    // CONTEXTO: mensagens no chat dos jobs onde participo
    // TODO: migrar pra join com jobs_chat_leituras pra contar so "nao lidas" de verdade
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs_mensagens")
          .select("id, job:jobs!inner(projeto_id)", {
            count: "exact",
            head: true,
          })
          .eq("tenant_id", tenantId)
          .in("job.projeto_id", projetoIds)
          .neq("autor_id", userId),
    // KPI CONTEXTO: jobs em andamento no time
    // "aberto" + "em_producao" (enum real)
    semProjetos
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("projeto_id", projetoIds)
          .in("status", ["aberto", "em_producao"]),
    // KPI ESTRITO: PPs que eu emiti este mes
    // Adendo §9: "emitida_em" nao existe → usar "created_at"
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("emitida_por", userId)
      .gte("created_at", primeiro + "T00:00:00")
      .lte("created_at", ultimo + "T23:59:59"),
  ]);

  const pendencias: CardPendencia[] = [
    {
      titulo: "PPs rejeitadas",
      contagem: ppsRejeitadas.count ?? 0,
      subtitulo: "Suas PPs devolvidas pelo financeiro",
      href: "/jobs?filtro=pps_rejeitadas&meus=1",
      icone: FileClock,
    },
    {
      titulo: "Realizado a preencher",
      contagem: realizadoPendente.count ?? 0,
      subtitulo: "Itens dos seus jobs sem valor registrado",
      href: "/jobs?filtro=realizado_pendente&meus=1",
      icone: FileText,
    },
    {
      titulo: "Mensagens no chat",
      contagem: mensagensNaoLidas.count ?? 0,
      subtitulo: "Chat dos jobs em que você participa",
      href: "/jobs?filtro=chat_pendente&meus=1",
      icone: MessageSquare,
    },
  ];

  const kpis: CardKpi[] = [
    {
      titulo: "Meus jobs em andamento",
      valor: String(meusJobsAndamento.count ?? 0),
      subtitulo: "Time inteiro, aberto ou em produção",
      href: "/jobs?meus=1",
      icone: Briefcase,
    },
    {
      titulo: "PPs emitidas por mim",
      valor: String(ppsEmitidasMes.count ?? 0),
      subtitulo: "No mês corrente",
      href: "/jobs?filtro=minhas_pps&meus=1",
      icone: Receipt,
    },
  ];

  return { pendencias, kpis };
}

// ---------------------------------------------------------------------------
// Cards de faturamento e encerramento (decisão 105)

/** Os jobs que ainda devem o envio para faturamento: abertos ou encerrados
 *  (o encerrado ainda fatura desde a decisão 087), com faturamento previsto
 *  e sem o envio completo — `faturamento_enviado_em` é o carimbo que o
 *  banco grava quando o envio cobre o previsto (decisão 094; no mensal,
 *  com todos os meses enviados). Job sem faturamento nunca entra.
 *
 *  `responsavelId` recorta nos jobs de um GP (o "Meus" da lista de jobs,
 *  decisão 036); sem ele, a empresa inteira. É a mesma régua do filtro
 *  `/jobs?filtro=faturamento_pendente`. Só conta: `head: true`. */
function pendentesDeEnvioQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  responsavelId?: string,
) {
  let q = supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("status", ["aberto", "em_producao", "encerrado"])
    .gt("faturamento_previsto", 0.004)
    .is("faturamento_enviado_em", null);
  if (responsavelId) q = q.eq("responsavel_id", responsavelId);
  return q;
}

/** O job aberto que o botão "Enviar job para encerramento" liberaria
 *  agora (decisão 105, 25/09/2026): sem PP por pagar, sem verba com
 *  prestação por aprovar, sem BV por receber, com todo item marcado como
 *  "todas as PPs geradas", sem save aguardando ou por enviar e sem revisão
 *  da abertura. A régua é a do próprio encerramento
 *  (`impedimentosDosJobs`), para o card nunca contar o que o botão recusa.
 *
 *  O envio para faturamento NÃO entra: desde a decisão 087 faturamento e
 *  encerramento correm separados.
 *
 *  É uma segunda onda de leituras, depois da primeira: depende dos ids dos
 *  jobs. Sete consultas em paralelo, qualquer que seja o número de jobs. */
async function contarProntosPraEncerrar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  res: { data: unknown; error?: { message: string } | null },
): Promise<number> {
  if (res.error) console.error("[home.gp.jobs_abertos]", res.error.message);
  const abertos = ((res.data ?? []) as { id: string }[]).map((j) => j.id);
  if (abertos.length === 0) return 0;
  const impedimentos = await impedimentosDosJobs(supabase, tenantId, abertos);
  return abertos.filter((id) => {
    const imp = impedimentos.get(id);
    return imp ? podeEncerrar(imp) : false;
  }).length;
}
