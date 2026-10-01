"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

function assertRh(role: string): ActionResult | null {
  if (role !== "administrador" && role !== "rh") {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  return null;
}

async function carregarLancamento(id: string, tenantId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, tenant_id, colaborador_id, periodo_id, tipo, dias, data_inicio, data_fim, status, solicitado_por",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

async function destinatariosDoColaborador(
  tenantId: string,
  colaboradorId: string,
): Promise<string[]> {
  const supabase = createClient();
  const [{ data: colab }, { data: solicitante }] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("user_id, lider_id, nome")
      .eq("id", colaboradorId)
      .maybeSingle(),
    Promise.resolve({ data: null }),
  ]);

  const set = new Set<string>();
  if (colab?.user_id) set.add(colab.user_id);
  if (colab?.lider_id) set.add(colab.lider_id);
  return Array.from(set);
}

// ---------- Aprovar ----------

export async function aprovarLancamento(
  lancamentoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancamentoId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "pendente_aprovacao" && lanc.status !== "em_analise") {
    return {
      ok: false,
      message:
        "Só é possível aprovar solicitações pendentes ou em análise.",
    };
  }

  const supabase = createClient();
  const { error: updErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "aprovado",
      aprovado_por: session.profile.id,
      aprovado_em: new Date().toISOString(),
      motivo_reprovacao: null,
    })
    .eq("id", lancamentoId);

  if (updErr) {
    console.error("[rh.ferias.aprovar]", updErr.message);
    return { ok: false, message: "Falha ao aprovar: " + updErr.message };
  }

  // Notifica o colaborador + líder
  const destinatarios = await destinatariosDoColaborador(
    tenantId,
    lanc.colaborador_id,
  );
  if (destinatarios.length > 0) {
    const diasStr = `${lanc.dias} dia${lanc.dias > 1 ? "s" : ""}`;
    await supabase.rpc("fn_criar_notificacao_ferias", {
      p_tenant_id: tenantId,
      p_tipo: "aprovada",
      p_colaborador_id: lanc.colaborador_id,
      p_destinatarios: destinatarios,
      p_titulo: "Férias aprovadas",
      p_mensagem: `Sua solicitação de ${diasStr} entre ${lanc.data_inicio} e ${lanc.data_fim} foi aprovada.`,
      p_payload: {
        dias: lanc.dias,
        tipo: lanc.tipo,
        data_inicio: lanc.data_inicio,
        data_fim: lanc.data_fim,
      },
      p_lancamento_id: lanc.id,
      p_periodo_id: lanc.periodo_id,
    });
  }

  await logAuditEvent({
    acao: "ferias.lancamento.aprovado",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      tipo: lanc.tipo,
      dias: lanc.dias,
    },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Reprovar ----------

const reprovarSchema = z.object({
  lancamento_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(5, "O motivo precisa ter pelo menos 5 caracteres.")
    .max(500, "O motivo é longo demais."),
});

export async function reprovarLancamento(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = reprovarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.flatten().fieldErrors.motivo?.[0] ??
        "Dados inválidos.",
    };
  }
  const { lancamento_id: lancId, motivo } = parsed.data;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (
    lanc.status !== "pendente_aprovacao" &&
    lanc.status !== "em_analise"
  ) {
    return {
      ok: false,
      message:
        "Só é possível reprovar solicitações pendentes ou em análise.",
    };
  }

  const supabase = createClient();
  const { error: updErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "reprovado",
      aprovado_por: session.profile.id,
      aprovado_em: new Date().toISOString(),
      motivo_reprovacao: motivo,
    })
    .eq("id", lancId);

  if (updErr) {
    console.error("[rh.ferias.reprovar]", updErr.message);
    return { ok: false, message: "Falha ao reprovar: " + updErr.message };
  }

  const destinatarios = await destinatariosDoColaborador(
    tenantId,
    lanc.colaborador_id,
  );
  if (destinatarios.length > 0) {
    await supabase.rpc("fn_criar_notificacao_ferias", {
      p_tenant_id: tenantId,
      p_tipo: "reprovada",
      p_colaborador_id: lanc.colaborador_id,
      p_destinatarios: destinatarios,
      p_titulo: "Férias reprovadas",
      p_mensagem: `Sua solicitação entre ${lanc.data_inicio} e ${lanc.data_fim} foi reprovada. Motivo: ${motivo}`,
      p_payload: { motivo, dias: lanc.dias },
      p_lancamento_id: lanc.id,
      p_periodo_id: lanc.periodo_id,
    });
  }

  await logAuditEvent({
    acao: "ferias.lancamento.reprovado",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: lanc.colaborador_id,
      motivo,
      dias: lanc.dias,
    },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Mover para "em análise" ----------

const emAnaliseSchema = z.object({
  lancamento_id: z.string().uuid(),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export async function moverEmAnalise(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = emAnaliseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos." };
  }
  const { lancamento_id: lancId, observacao } = parsed.data;

  const tenantId = session.activeTenant.id;
  const lanc = await carregarLancamento(lancId, tenantId);
  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "pendente_aprovacao") {
    return {
      ok: false,
      message: "Só é possível mover para análise solicitações pendentes.",
    };
  }

  const supabase = createClient();
  const { error: updErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "em_analise",
      observacao: observacao || null,
    })
    .eq("id", lancId);

  if (updErr) {
    console.error("[rh.ferias.em_analise]", updErr.message);
    return { ok: false, message: "Falha: " + updErr.message };
  }

  const destinatarios = await destinatariosDoColaborador(
    tenantId,
    lanc.colaborador_id,
  );
  if (destinatarios.length > 0) {
    await supabase.rpc("fn_criar_notificacao_ferias", {
      p_tenant_id: tenantId,
      p_tipo: "em_analise",
      p_colaborador_id: lanc.colaborador_id,
      p_destinatarios: destinatarios,
      p_titulo: "Férias em análise",
      p_mensagem: observacao
        ? `Sua solicitação está em análise. Observação do RH: ${observacao}`
        : "Sua solicitação está em análise pelo RH.",
      p_payload: { observacao },
      p_lancamento_id: lanc.id,
      p_periodo_id: lanc.periodo_id,
    });
  }

  await logAuditEvent({
    acao: "ferias.lancamento.movido_em_analise",
    tenantId,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: { colaborador_id: lanc.colaborador_id, observacao },
  });

  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Marcar notificação como lida ----------

export async function marcarNotificacaoLida(
  id: string,
): Promise<ActionResult> {
  await requireSession();
  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores_ferias_notificacoes")
    .update({ lida_em: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/rh/ferias");
  revalidatePath("/perfil");
  return { ok: true, id };
}
