"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarSolicitacaoSchema,
  rejeitarSolicitacaoSchema,
} from "@/lib/validations/freelancer-solicitacoes";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

function parseForm(formData: FormData, schema: any) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  return schema.safeParse(raw);
}

export async function criarSolicitacao(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();

  const parsed = parseForm(formData, criarSolicitacaoSchema);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const origem = parsed.data.job_origem;
  const supabase = createClient();

  // Regra de negócio: um freela não pode ter 2 vínculos ativos ao mesmo
  // tempo. Bloqueia se o freela tiver qualquer solicitação em andamento
  // (pendente/aprovada/cadastrada) ou contrato ativo. Só aplica quando o
  // form identificou o freela (freelancer_id setado — pelo CPF casando
  // com cadastro existente). Freela realmente novo não tem como colidir.
  let freelancerIdResolvido = parsed.data.freelancer_id ?? null;
  if (!freelancerIdResolvido && parsed.data.cpf_freela) {
    const { data: freelaByCpf } = await supabase
      .from("freelancers")
      .select("id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("cpf", parsed.data.cpf_freela)
      .maybeSingle();
    freelancerIdResolvido =
      (freelaByCpf as { id: string } | null)?.id ?? null;
  }
  if (freelancerIdResolvido) {
    // RPC SECURITY DEFINER. SELECT direto em freelancer_contratos e
    // freelancer_solicitacoes esbarra na RLS que esconde contratos de
    // outros responsáveis — pro GP, sobreposição com contrato de outro
    // GP ficava invisível (mesma classe do bug do trigger e do endpoint
    // buscar-por-cpf, migrations 20261111100001/100004/100005).
    const { data: dispRes, error: dispErr } = await supabase.rpc(
      "freelancer_verificar_disponibilidade",
      {
        p_tenant_id: session.activeTenant.id,
        p_freelancer_id: freelancerIdResolvido,
        p_data_inicio: parsed.data.data_inicio ?? null,
        p_data_termino: parsed.data.data_termino ?? null,
      },
    );
    if (dispErr) {
      console.error("[solicitacao.criar.verificar_disp]", dispErr.message);
      return { ok: false, message: "Erro ao verificar disponibilidade" };
    }
    const row = Array.isArray(dispRes) && dispRes.length > 0 ? dispRes[0] : null;
    if (row?.bloqueado) {
      return { ok: false, message: row.motivo ?? "Freela indisponível" };
    }
  }

  const { data, error } = await supabase
    .from("freelancer_solicitacoes")
    .insert({
      tenant_id: session.activeTenant.id,
      solicitante_id: session.profile.id,
      nome_freela: parsed.data.nome_freela,
      cpf_freela: parsed.data.cpf_freela ?? null,
      // Vem preenchido quando o form já identificou o cadastro via CPF; se não
      // vier, o trigger resolver_freelancer_id_por_cpf cuida no banco.
      freelancer_id: parsed.data.freelancer_id ?? null,
      // Grava na coluna da fonte certa (CHECK no banco garante exclusividade).
      job_id: origem === "producao" ? parsed.data.job_id : null,
      job_interno_id: origem === "interno" ? parsed.data.job_id : null,
      cargo: parsed.data.cargo ?? null,
      tipo: parsed.data.tipo,
      valor: parsed.data.valor,
      data_inicio: parsed.data.data_inicio ?? null,
      data_termino: parsed.data.data_termino ?? null,
      cidade: parsed.data.cidade ?? null,
      observacoes: parsed.data.observacoes ?? null,
      status: "pendente",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[solicitacao.criar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: data.id,
    metadata: { nome_freela: parsed.data.nome_freela },
  });

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true, data: { id: data.id } };
}

export async function aprovarSolicitacao(
  id: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!APROVADORES.has(session.activeRole)) {
    return { ok: false, message: "Sem permissão para aprovar" };
  }

  const supabase = createClient();

  // RPC única SECURITY DEFINER: UPDATE status='aprovada' + eventual criação
  // de contrato (renovação) + eventual dispensa→finalizada numa transação só.
  // Antes isso era feito em dois round-trips (UPDATE + RPC criar_contrato),
  // e qualquer glitch na segunda chamada deixava a solicitação em estado
  // zumbi (aprovada sem contrato) — incidente Bianca, 10/11/2026. Ver
  // migration 20261112200001.
  const { data, error } = await supabase.rpc("aprovar_solicitacao", {
    p_solicitacao_id: id,
  });

  if (error) {
    console.error("[solicitacao.aprovar]", error.message);
    return { ok: false, message: error.message };
  }

  const row = (Array.isArray(data) && data.length > 0 ? data[0] : null) as
    | { contrato_id: string | null; finalizada: boolean; is_renovacao: boolean }
    | null;

  await logAuditEvent({
    acao: "freelancer_solicitacao.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: id,
  });

  if (row?.finalizada) {
    await logAuditEvent({
      acao: "freelancer_solicitacao.finalizada_por_dispensa",
      tenantId: session.activeTenant.id,
      entidadeTipo: "freelancer_solicitacao",
      entidadeId: id,
      metadata: { contrato_id: row.contrato_id ?? null },
    });
  }

  revalidatePath("/freelancers/solicitacoes");
  revalidatePath("/freelancers");
  return { ok: true };
}

/**
 * Aprova várias solicitações pendentes em paralelo. Devolve contagem de
 * sucessos/falhas sem interromper na primeira falha — admin consegue ver o
 * resultado completo.
 */
export async function aprovarSolicitacoesEmLote(
  ids: string[],
): Promise<ActionResult<{ aprovadas: number; falharam: number }>> {
  const session = await requireSession();
  if (!APROVADORES.has(session.activeRole)) {
    return { ok: false, message: "Sem permissão para aprovar" };
  }
  if (ids.length === 0) {
    return { ok: true, data: { aprovadas: 0, falharam: 0 } };
  }

  const supabase = createClient();
  let aprovadas = 0;
  let falharam = 0;

  // Chama a RPC atômica uma vez por id. Cada chamada é uma transação
  // Postgres independente, então um erro em uma solicitação não deixa
  // outra em estado parcial. Audit events são logados com base no retorno
  // de cada chamada.
  for (const id of ids) {
    const { data, error } = await supabase.rpc("aprovar_solicitacao", {
      p_solicitacao_id: id,
    });
    if (error) {
      console.error("[solicitacao.aprovar_lote]", id, error.message);
      falharam++;
      continue;
    }
    aprovadas++;
    const row = (Array.isArray(data) && data.length > 0 ? data[0] : null) as
      | { contrato_id: string | null; finalizada: boolean; is_renovacao: boolean }
      | null;

    await logAuditEvent({
      acao: "freelancer_solicitacao.aprovada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "freelancer_solicitacao",
      entidadeId: id,
    });

    if (row?.finalizada) {
      await logAuditEvent({
        acao: "freelancer_solicitacao.finalizada_por_dispensa",
        tenantId: session.activeTenant.id,
        entidadeTipo: "freelancer_solicitacao",
        entidadeId: id,
        metadata: { contrato_id: row.contrato_id ?? null },
      });
    }
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.aprovada_em_lote",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: null,
    metadata: { ids_pedidos: ids, aprovadas, falharam },
  });

  revalidatePath("/freelancers/solicitacoes");
  revalidatePath("/freelancers");
  return { ok: true, data: { aprovadas, falharam } };
}

export async function rejeitarSolicitacao(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!APROVADORES.has(session.activeRole)) {
    return { ok: false, message: "Sem permissão para rejeitar" };
  }

  const parsed = parseForm(formData, rejeitarSolicitacaoSchema);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Motivo inválido",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancer_solicitacoes")
    .update({
      status: "rejeitada",
      rejeitado_por: session.profile.id,
      rejeitado_em: new Date().toISOString(),
      rejeicao_motivo: parsed.data.motivo,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "pendente");

  if (error) {
    console.error("[solicitacao.rejeitar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.rejeitada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: id,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true };
}

export async function enviarMensagem(
  solicitacaoId: string,
  texto: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const sanitizado = texto.trim();
  if (sanitizado.length === 0 || sanitizado.length > 2000) {
    return { ok: false, message: "Mensagem precisa ter entre 1 e 2000 caracteres" };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancer_solicitacao_mensagens")
    .insert({
      solicitacao_id: solicitacaoId,
      autor_id: session.profile.id,
      texto: sanitizado,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[solicitacao.mensagem.enviar]", error.message);
    return { ok: false, message: error.message };
  }

  // Não revalida — Realtime cuida de notificar os outros clientes
  return { ok: true, data: { id: data.id } };
}

export async function marcarMensagensComoLidas(
  solicitacaoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("freelancer_solicitacao_mensagens_leituras")
    .upsert(
      {
        solicitacao_id: solicitacaoId,
        user_id: session.profile.id,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "solicitacao_id,user_id" },
    );

  if (error) {
    console.error("[solicitacao.mensagem.marcar_lida]", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true };
}

export async function cancelarSolicitacao(
  id: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // RLS garante que o user pode mesmo cancelar (solicitante ou admin/rh/fin)
  const { error } = await supabase
    .from("freelancer_solicitacoes")
    .update({
      status: "cancelada",
      cancelado_por: session.profile.id,
      cancelado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["pendente", "aprovada"]);

  if (error) {
    console.error("[solicitacao.cancelar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: id,
  });

  revalidatePath("/freelancers/solicitacoes");
  return { ok: true };
}
