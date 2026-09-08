"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AREA_FINANCEIRO } from "@/lib/types";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  carregarThreadPPs,
  listarConversasPPs,
  type ConversaPPs,
  type ThreadPPsDoJob,
} from "@/lib/data/chat-pps-conversas";

type Err = { ok: false; message: string };

const textoSchema = z
  .string()
  .trim()
  .min(1, "Escreva alguma coisa antes de enviar.")
  .max(2000, "Mensagem passa de 2000 caracteres.");

/**
 * Actions do chat de PPs pelo lado do FINANCEIRO (decisão 058).
 *
 * Nada aqui chama `revalidatePath("/financeiro/contas-a-pagar")`: aquela
 * página é a mais cara do sistema e revalidá-la a cada mensagem
 * recarregaria PPs, títulos, cartões e recorrências inteiros. O drawer
 * pede de volta só a lista ou só o fio, que é o que mudou.
 */

/** A lista de conversas. Uma linha por job que já mandou PP ao financeiro. */
export async function recarregarConversasPPs(): Promise<ConversaPPs[]> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "financeiro.contas_pagar");
  if (!gate.ok) return [];
  const supabase = createClient();
  return listarConversasPPs(supabase, session.activeTenant.id);
}

/** O fio de um job só, montado sob demanda quando a conversa é aberta. */
export async function abrirThreadPPs(
  jobId: string,
): Promise<ThreadPPsDoJob | null> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "financeiro.contas_pagar");
  if (!gate.ok) return null;
  const supabase = createClient();
  return carregarThreadPPs(supabase, session.activeTenant.id, jobId);
}

/**
 * Envia mensagem no fio de PPs pelo lado do financeiro.
 *
 * A área é fixa em "financeiro" — vem da tela, não do papel nem do
 * cliente — e o gate é `chat.enviar_financeiro`, que a produção não
 * passa. É o que garante que o rótulo do balão signifique alguma coisa.
 */
export async function enviarMensagemPPFinanceiro(
  jobId: string,
  texto: string,
): Promise<{ ok: true; thread: ThreadPPsDoJob | null } | Err> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "chat.enviar_financeiro");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const parsed = textoSchema.safeParse(texto);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Mensagem inválida.",
    };
  }

  // O job precisa existir no tenant E já ter mandado PP ao financeiro:
  // é esse o universo do chat, e a trava não pode viver só na lista do
  // cliente.
  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select("id, job:jobs!inner(id, tenant_id)")
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "gerada")
    .limit(1)
    .maybeSingle();

  if (ppErr) {
    console.error("[chat-pps-financeiro.job]", ppErr.message);
    return { ok: false, message: "Falha ao localizar o job." };
  }
  if (!pp) {
    return {
      ok: false,
      message: "Este job ainda não enviou nenhuma PP ao financeiro.",
    };
  }

  const { error } = await supabase.from("jobs_mensagens").insert({
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    autor_id: session.profile.id,
    area: AREA_FINANCEIRO,
    escopo: "pps",
    texto: parsed.data,
  });

  if (error) {
    console.error("[chat-pps-financeiro.enviar]", error.message);
    return { ok: false, message: "Falha ao enviar a mensagem." };
  }

  await marcarConversaPPsLida(jobId);

  return {
    ok: true,
    thread: await carregarThreadPPs(supabase, session.activeTenant.id, jobId),
  };
}

/** Zera o contador de não lidas deste usuário neste fio de PPs. */
export async function marcarConversaPPsLida(
  jobId: string,
): Promise<{ ok: boolean }> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase.from("jobs_chat_leituras").upsert(
    {
      tenant_id: session.activeTenant.id,
      job_id: jobId,
      profile_id: session.profile.id,
      escopo: "pps",
      lida_ate: new Date().toISOString(),
    },
    { onConflict: "job_id,profile_id,escopo" },
  );

  if (error) {
    console.error("[chat-pps-financeiro.marcar_lido]", error.message);
    return { ok: false };
  }
  return { ok: true };
}
