import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatArea, ItemChat, JobMensagem } from "@/lib/types";
import {
  montarThreadChatPPs,
  type PPParaThreadChat,
} from "@/lib/data/job-chat-pps";

/**
 * A caixa de entrada do chat de PPs do financeiro (decisão 058).
 *
 * Dentro do job existe UM fio, e ele vem pronto do server component. Em
 * Contas a Pagar existe um fio POR JOB, e carregar todos de uma vez numa
 * página que já é a mais pesada do sistema estava fora de questão
 * (`docs/PERFORMANCE.md`). Então o carregamento é em dois tempos:
 *
 * 1. `listarConversasPPs` — a lista. Uma RPC agregada (uma linha por job)
 *    mais um `select` dos nomes dos jobs. Roda no load da página e a cada
 *    evento de realtime.
 * 2. `carregarThreadPPs` — o fio de UM job. Só quando a pessoa abre a
 *    conversa.
 */

export interface ConversaPPs {
  jobId: string;
  jobCodigo: string;
  jobNome: string;
  /** Cliente + projeto, pra distinguir dois jobs de nome parecido. */
  contexto: string | null;
  /** ISO da última mensagem humana. `null` = ninguém escreveu ainda. */
  ultimaEm: string | null;
  ultimoTexto: string | null;
  ultimoAutor: string | null;
  ultimaArea: ChatArea | null;
  naoLidas: number;
  /** ISO da PP mais recente enviada ao financeiro. Nunca nulo — é o que
   *  põe o job na lista. */
  ultimaPPEm: string;
}

interface LinhaRPC {
  job_id: string;
  ultima_pp_em: string;
  ultima_em: string | null;
  ultimo_texto: string | null;
  ultimo_autor: string | null;
  ultima_area: ChatArea | null;
  nao_lidas: number;
}

export async function listarConversasPPs(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ConversaPPs[]> {
  const { data, error } = await supabase.rpc("chat_pps_conversas", {
    p_tenant_id: tenantId,
  });

  if (error) {
    console.error("[chat-pps.conversas]", error.message);
    return [];
  }

  const linhas = (data ?? []) as LinhaRPC[];
  if (linhas.length === 0) return [];

  const { data: jobs, error: jobsErr } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, projeto:projetos(nome, cliente:clientes(nome_fantasia))",
    )
    .eq("tenant_id", tenantId)
    .in(
      "id",
      linhas.map((l) => l.job_id),
    );

  if (jobsErr) {
    console.error("[chat-pps.conversas_jobs]", jobsErr.message);
    return [];
  }

  const porId = new Map<string, any>((jobs ?? []).map((j: any) => [j.id, j]));

  const conversas: ConversaPPs[] = [];
  for (const l of linhas) {
    const job = porId.get(l.job_id);
    // Job fora do alcance do RLS de quem está lendo: some da lista em vez
    // de virar uma linha "—" sem sentido.
    if (!job) continue;

    const cliente = job.projeto?.cliente?.nome_fantasia ?? null;
    const projeto = job.projeto?.nome ?? null;

    conversas.push({
      jobId: l.job_id,
      jobCodigo: job.codigo,
      jobNome: job.nome,
      contexto: [cliente, projeto].filter(Boolean).join(" · ") || null,
      ultimaEm: l.ultima_em,
      ultimoTexto: l.ultimo_texto,
      ultimoAutor: l.ultimo_autor,
      ultimaArea: l.ultima_area,
      naoLidas: l.nao_lidas ?? 0,
      ultimaPPEm: l.ultima_pp_em,
    });
  }

  return ordenarConversas(conversas);
}

/**
 * Quem já tem conversa vem primeiro, pela mensagem mais recente. Quem só
 * tem PP vem depois, pela PP mais recente (decisão 058).
 *
 * A PP não disputa a mesma ordenação de propósito: se disputasse, uma PP
 * recém-enviada empurraria o job pro topo — que é, na prática, notificar.
 * E PP não notifica.
 */
export function ordenarConversas(conversas: ConversaPPs[]): ConversaPPs[] {
  return [...conversas].sort((a, b) => {
    if (a.ultimaEm && b.ultimaEm) return b.ultimaEm.localeCompare(a.ultimaEm);
    if (a.ultimaEm) return -1;
    if (b.ultimaEm) return 1;
    return b.ultimaPPEm.localeCompare(a.ultimaPPEm);
  });
}

export interface ThreadPPsDoJob {
  jobId: string;
  jobCodigo: string;
  jobNome: string;
  itens: ItemChat[];
}

/**
 * O fio de PPs de um job, montado do mesmo jeito que a aba PPs do job
 * monta — `montarThreadChatPPs` é o mesmo, então os dois lados nunca
 * divergem de conteúdo nem de ordem.
 */
export async function carregarThreadPPs(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<ThreadPPsDoJob | null> {
  const [jobRes, ppsRes, msgsRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, versao:versoes_orcamento!versao_orcamento_aprovada_id(moeda)",
      )
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("pedidos_compra")
      .select(
        "id, codigo, status, servico, valor, fornecedor_id, verba_producao, " +
          "prazo_pagamento, enviada_financeiro_em, created_at, updated_at, " +
          "fornecedor:fornecedores(id, nome, razao_social), " +
          "emitido:profiles!emitida_por(nome), " +
          "enviado:profiles!enviada_financeiro_por(nome), " +
          "responsavel:profiles!responsavel_verba_id(nome)",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .neq("status", "gerada"),
    supabase
      .from("jobs_mensagens")
      .select("*, autor:profiles!autor_id(nome)")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .eq("escopo", "pps")
      .order("created_at", { ascending: true }),
  ]);

  const job = jobRes.data as any;
  if (jobRes.error || !job) return null;
  if (ppsRes.error) console.error("[chat-pps.thread_pps]", ppsRes.error.message);
  if (msgsRes.error)
    console.error("[chat-pps.thread_msgs]", msgsRes.error.message);

  const fornecedoresPorId: Record<string, string> = {};
  const pps: PPParaThreadChat[] = ((ppsRes.data ?? []) as any[]).map((pp) => {
    if (pp.fornecedor?.id) {
      fornecedoresPorId[pp.fornecedor.id] =
        pp.fornecedor.razao_social ?? pp.fornecedor.nome;
    }
    return {
      id: pp.id,
      codigo: pp.codigo,
      status: pp.status,
      servico: pp.servico,
      valor: Number(pp.valor ?? 0),
      fornecedor_id: pp.fornecedor_id,
      verba_producao: pp.verba_producao,
      prazo_pagamento: pp.prazo_pagamento,
      enviada_financeiro_em: pp.enviada_financeiro_em,
      created_at: pp.created_at,
      updated_at: pp.updated_at,
      emitida_por_nome: pp.emitido?.nome ?? null,
      enviada_financeiro_por_nome: pp.enviado?.nome ?? null,
      responsavel: pp.responsavel ?? null,
    };
  });

  const mensagens = ((msgsRes.data ?? []) as any[]).map((m) => ({
    ...(m as JobMensagem),
    autor_nome: m.autor?.nome ?? null,
  }));

  // `versao` chega como objeto pelo embed de FK única; a moeda cai pra BRL
  // se o job estiver sem versão aprovada (não deveria acontecer, mas o
  // chat não é lugar de derrubar a tela por isso).
  const moeda = (job.versao as { moeda?: string } | null)?.moeda ?? "BRL";

  return {
    jobId: job.id,
    jobCodigo: job.codigo,
    jobNome: job.nome,
    itens: montarThreadChatPPs(pps, mensagens, moeda, fornecedoresPorId),
  };
}
