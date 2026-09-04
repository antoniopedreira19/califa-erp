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
  MessageSquare,
  Wallet,
} from "lucide-react";
import type { SessionContext } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import type { CardKpi, CardPendencia, DadosHome } from "./tipos";

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
 * Home do Administrador: ve o tenant inteiro. Cards de pendencia e KPIs
 * do mes corrente. Todas as contagens em Promise.all — nenhuma query
 * bloqueia a proxima.
 *
 * Substituicoes do adendo (schema real):
 * - titulos_a_pagar → vw_a_pagar (data_prevista, sem data_pagamento)
 * - titulos_a_receber → titulos_receber (data_previsao_recebimento, pago_em)
 * - contas_bancarias.saldo_atual → saldo_inicial (aproximacao V1)
 * - jobs.status "em_producao" removido (nao existe); apenas "aberto"
 * - orcamentos.status "enviado_cliente" removido; substituido por "rascunho"
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
  const em7dias = diasNoFuturo(7);
  const ha15dias = diasNoFuturo(-15);

  const [
    contasPagarVencidas,
    contasReceberVencidas,
    jobsAguardandoAbertura,
    ppsEmAvaliacao,
    desembolsosEmAvaliacao,
    jobsFaturamentoProximo,
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
    // jobs.status nao tem "em_producao"; apenas "aberto" (adendo §5)
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "aberto")
      .gte("data_prevista_faturamento", hoje)
      .lte("data_prevista_faturamento", em7dias),
    // orcamentos.status nao tem "enviado_cliente"; substituido por "rascunho" (adendo §6)
    supabase
      .from("orcamentos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["rascunho", "em_revisao"])
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
    // jobs em andamento: apenas "aberto" (adendo §5)
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "aberto"),
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
      contagem: jobsAguardandoAbertura.count ?? 0,
      subtitulo: "Fila do financeiro pra abrir jobs",
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
      titulo: "Jobs com faturamento próximo",
      contagem: jobsFaturamentoProximo.count ?? 0,
      subtitulo: "Data prevista nos próximos 7 dias",
      href: "/jobs?filtro=faturamento_proximo",
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
      contagem: jobsAguardandoAbertura.count ?? 0,
      subtitulo: "Sua fila principal",
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
 * - jobs.status "em_producao" removido; apenas "aberto" (adendo §5)
 * - jobs_itens_realizado.valor_total_realizado → total_realizado (adendo §8)
 */
export async function carregarHomeFreelancer(
  session: SessionContext,
): Promise<DadosHome> {
  const supabase = await createClient();
  const tenantId = session.activeTenant.id;

  const [meusJobsAtivos, realizadoPendente, mensagensNaoLidas] =
    await Promise.all([
      // jobs.status nao tem "em_producao"; apenas "aberto" (adendo §5)
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "aberto"),
      // jobs_itens_realizado.total_realizado (adendo §8)
      supabase
        .from("jobs_itens_realizado")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("total_realizado", null),
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
      titulo: "Mensagens não lidas",
      contagem: mensagensNaoLidas.count ?? 0,
      subtitulo: "No chat dos seus jobs",
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
