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
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Lê a solicitação antes de aprovar pra decidir o que fazer:
  //   - freelancer_id setado = renovação → cria contrato automaticamente
  //     com os dados da solicitação (herda job_id/job_interno_id se tiver,
  //     ou nasce legado quando só vier `nome_job` em texto)
  //   - freelancer_id null = contratação nova → só muda status, aguarda
  //     o freela preencher o form público (fluxo que já existia)
  const { data: solicitacao, error: readErr } = await supabase
    .from("freelancer_solicitacoes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "pendente")
    .maybeSingle();
  if (readErr) {
    console.error("[solicitacao.aprovar.read]", readErr.message);
    return { ok: false, message: readErr.message };
  }
  if (!solicitacao) {
    return { ok: false, message: "Solicitação não encontrada ou já processada" };
  }

  const { error } = await supabase
    .from("freelancer_solicitacoes")
    .update({
      status: "aprovada",
      aprovado_por: session.profile.id,
      aprovado_em: agora.toISOString(),
      expira_em: expiraEm.toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "pendente");

  if (error) {
    console.error("[solicitacao.aprovar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer_solicitacao.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: id,
  });

  // Renovação: cria contrato na hora + aponta de volta pra solicitação.
  // O status da solicitação segue `aprovada` (vira `cadastrada` só quando
  // a minuta é gerada — ver endpoint gerar-minuta).
  if (solicitacao.freelancer_id) {
    // Migração automática de responsável: se quem solicitou não é o dono
    // atual do cadastro, troca o dono pra ela antes de criar o contrato.
    // Assim o contrato já nasce com o responsável certo (criarContratoDeRenovacao
    // puxa de freelancers.responsavel_id).
    await migrarResponsavelSeNecessario(
      supabase,
      session,
      solicitacao,
    );

    const contratoRes = await criarContratoDeRenovacao(
      supabase,
      session,
      solicitacao,
    );
    if (!contratoRes.ok) {
      // Loga o erro mas não desfaz a aprovação — o RH consegue criar o
      // contrato manualmente pelo perfil do freela se der problema.
      console.error(
        "[solicitacao.aprovar.criar_contrato]",
        contratoRes.message,
      );
    }
  }

  revalidatePath("/freelancers/solicitacoes");
  revalidatePath("/freelancers");
  return { ok: true };
}

/**
 * Transferência automática de responsável na aprovação (decisão 03/11/2026):
 * quando o solicitante não é o dono atual do cadastro, o cadastro migra pra
 * ele antes do contrato ser criado. Objetivo: "quem pede novo contrato pra um
 * freela parado assume a pessoa — sem precisar de 'Transferir responsável'
 * manual antes". Idempotente: se já é o mesmo responsável, não faz nada.
 */
async function migrarResponsavelSeNecessario(
  supabase: ReturnType<typeof createClient>,
  session: Awaited<ReturnType<typeof requireSession>>,
  solicitacao: {
    id: string;
    freelancer_id: string;
    solicitante_id: string | null;
  },
): Promise<void> {
  if (!solicitacao.solicitante_id) return;

  const { data: freela } = await supabase
    .from("freelancers")
    .select("id, responsavel_id")
    .eq("id", solicitacao.freelancer_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!freela) return;
  const responsavelAtual = (freela as { responsavel_id: string | null })
    .responsavel_id;
  if (responsavelAtual === solicitacao.solicitante_id) return;

  const { error } = await supabase
    .from("freelancers")
    .update({
      responsavel_id: solicitacao.solicitante_id,
      updated_by: session.profile.id,
    })
    .eq("id", solicitacao.freelancer_id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    // Não aborta a aprovação — se falhar aqui, o contrato ainda vai ser
    // criado com o responsavel antigo e o RH pode transferir manualmente.
    console.error(
      "[solicitacao.aprovar.migrar_responsavel]",
      error.message,
    );
    return;
  }

  await logAuditEvent({
    acao: "freelancer.responsavel_transferido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer",
    entidadeId: solicitacao.freelancer_id,
    metadata: {
      de: responsavelAtual,
      para: solicitacao.solicitante_id,
      origem: "aprovacao_solicitacao",
      solicitacao_id: solicitacao.id,
    },
  });
}

/**
 * Cria o contrato na aprovação de uma renovação. Semântica importante:
 *   - Solicitação com `job_id` (ou `job_interno_id`): contrato nasce
 *     vinculado + origem_sistema = 'califa_erp'.
 *   - Solicitação só com `nome_job` em texto (migrada do RH antigo):
 *     contrato nasce legado + origem_sistema = 'ag_california_rh'. O
 *     CHECK `freelancer_contratos_job_obrigatorio_em_novos` permite
 *     contrato legado sem job.
 *   - `responsavel_id` do contrato: puxa do dono estável do freela
 *     (`freelancers.responsavel_id`) com fallback pro solicitante. Quando
 *     o solicitante ≠ responsável, migrarResponsavelSeNecessario já ajustou
 *     o cadastro antes desta função rodar.
 *
 * Atualiza a solicitação com `contrato_id` pra fechar o vínculo.
 */
async function criarContratoDeRenovacao(
  supabase: ReturnType<typeof createClient>,
  session: Awaited<ReturnType<typeof requireSession>>,
  solicitacao: any,
): Promise<ActionResult<{ contrato_id: string }>> {
  const { data: freela } = await supabase
    .from("freelancers")
    .select("id, responsavel_id")
    .eq("id", solicitacao.freelancer_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  const responsavelId =
    (freela as { responsavel_id: string | null } | null)?.responsavel_id ??
    solicitacao.solicitante_id ??
    null;

  const temJobVinculado =
    !!solicitacao.job_id || !!solicitacao.job_interno_id;
  const origemSistema = temJobVinculado ? "califa_erp" : "ag_california_rh";

  // Resolve o nome do job pra gravar como snapshot no contrato. Quando tem
  // job_id ou job_interno_id, busca o nome oficial — o campo nome_job da
  // solicitação só é preenchido em legados (texto solto, sem FK). Fallback
  // "Importado (sem job vinculado)" só entra pra legado realmente sem job.
  let nomeJobResolvido: string | null = null;
  if (solicitacao.job_id) {
    const { data: jobProd } = await supabase
      .from("jobs")
      .select("nome")
      .eq("id", solicitacao.job_id)
      .maybeSingle();
    nomeJobResolvido = (jobProd as { nome: string } | null)?.nome ?? null;
  } else if (solicitacao.job_interno_id) {
    const { data: jobInt } = await supabase
      .from("freelancer_jobs_internos")
      .select("nome")
      .eq("id", solicitacao.job_interno_id)
      .maybeSingle();
    nomeJobResolvido = (jobInt as { nome: string } | null)?.nome ?? null;
  }

  const { data: contrato, error: insertErr } = await supabase
    .from("freelancer_contratos")
    .insert({
      tenant_id: session.activeTenant.id,
      freelancer_id: solicitacao.freelancer_id,
      job_id: solicitacao.job_id,
      job_interno_id: solicitacao.job_interno_id,
      responsavel_id: responsavelId,
      nome_job:
        nomeJobResolvido ??
        solicitacao.nome_job ??
        "Importado (sem job vinculado)",
      cargo: solicitacao.cargo,
      tipo: solicitacao.tipo,
      valor: solicitacao.valor,
      data_inicio: solicitacao.data_inicio,
      data_termino: solicitacao.data_termino,
      cidade: solicitacao.cidade,
      observacoes: solicitacao.observacoes,
      origem_sistema: origemSistema,
      created_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .select("id")
    .single();

  if (insertErr || !contrato) {
    return {
      ok: false,
      message: insertErr?.message ?? "Falha ao criar contrato",
    };
  }

  await supabase
    .from("freelancer_solicitacoes")
    .update({ contrato_id: contrato.id })
    .eq("id", solicitacao.id)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "freelancer_contrato.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: contrato.id,
    metadata: {
      freelancer_id: solicitacao.freelancer_id,
      solicitacao_id: solicitacao.id,
      origem: "aprovacao_renovacao",
      origem_sistema: origemSistema,
    },
  });

  return { ok: true, data: { contrato_id: contrato.id } };
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
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("freelancer_solicitacoes")
    .update({
      status: "aprovada",
      aprovado_por: session.profile.id,
      aprovado_em: agora.toISOString(),
      expira_em: expiraEm.toISOString(),
    })
    .in("id", ids)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "pendente")
    .select("id");

  if (error) {
    console.error("[solicitacao.aprovar_lote]", error.message);
    return { ok: false, message: error.message };
  }

  const aprovadas = data?.length ?? 0;
  const falharam = ids.length - aprovadas;

  await logAuditEvent({
    acao: "freelancer_solicitacao.aprovada_em_lote",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_solicitacao",
    entidadeId: null,
    metadata: { ids_pedidos: ids, aprovadas, falharam },
  });

  revalidatePath("/freelancers/solicitacoes");
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
