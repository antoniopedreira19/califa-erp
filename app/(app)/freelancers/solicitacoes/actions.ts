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
    const bloqueio = await verificarFreelaDisponivel(
      supabase,
      session.activeTenant.id,
      freelancerIdResolvido,
      parsed.data.data_inicio ?? null,
      parsed.data.data_termino ?? null,
    );
    if (!bloqueio.ok) {
      return { ok: false, message: bloqueio.message };
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

/**
 * Verifica se o freela está disponível pra uma nova solicitação no período
 * pedido. Bloqueia se houver qualquer sobreposição de período com:
 *   - Contrato existente não encerrado (status_real = true)
 *   - Solicitação em andamento não-rejeitada/cancelada (pendente/aprovada/
 *     cadastrada/finalizada — inclui finalizada pra pegar contratações que
 *     já viraram contrato mas também bloqueiam novos pedidos sobrepostos)
 *
 * Período "aberto" (sem data_termino) conta como "até +∞" pra sobreposição.
 * Se o novo pedido não tem período definido, bloqueia sempre que houver
 * solicitação/contrato não-encerrado.
 *
 * Regra de negócio: um freela não pode acumular 2 vínculos em datas que se
 * sobreponham. Diferentes jobs não são exceção.
 */
async function verificarFreelaDisponivel(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  freelancerId: string,
  dataInicioNova: string | null,
  dataTerminoNova: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Convenções pra sobreposição:
  //   - Período aberto em qualquer lado vira ±∞
  //   - Overlap = max(inicios) <= min(terminos)
  const INFINITO_PASSADO = "0001-01-01";
  const INFINITO_FUTURO = "9999-12-31";
  const novoInicio = dataInicioNova ?? INFINITO_PASSADO;
  const novoFim = dataTerminoNova ?? INFINITO_FUTURO;

  // 1. Contratos do freela com status_real = true (não encerrados)
  const { data: contratos } = await supabase
    .from("freelancer_contratos")
    .select("id, nome_job, data_inicio, data_termino")
    .eq("tenant_id", tenantId)
    .eq("freelancer_id", freelancerId)
    .eq("status_real", true);
  for (const c of (contratos ?? []) as Array<{
    nome_job: string | null;
    data_inicio: string | null;
    data_termino: string | null;
  }>) {
    const cInicio = c.data_inicio ?? INFINITO_PASSADO;
    const cFim = c.data_termino ?? INFINITO_FUTURO;
    if (novoInicio <= cFim && cInicio <= novoFim) {
      const periodo =
        c.data_inicio && c.data_termino
          ? ` (${formatBr(c.data_inicio)} → ${formatBr(c.data_termino)})`
          : c.data_inicio
            ? ` (desde ${formatBr(c.data_inicio)})`
            : "";
      return {
        ok: false,
        message: `Este freela tem contrato em "${c.nome_job ?? "—"}"${periodo} que se sobrepõe ao período pedido. Finalize/encerre antes de criar nova solicitação.`,
      };
    }
  }

  // 2. Solicitações do freela em andamento ou já convertidas em contrato
  const { data: sols } = await supabase
    .from("freelancer_solicitacoes")
    .select("id, status, nome_job, data_inicio, data_termino, contrato_id")
    .eq("tenant_id", tenantId)
    .eq("freelancer_id", freelancerId)
    .in("status", ["pendente", "aprovada", "cadastrada", "finalizada"]);
  for (const s of (sols ?? []) as Array<{
    status: string;
    nome_job: string | null;
    data_inicio: string | null;
    data_termino: string | null;
    contrato_id: string | null;
  }>) {
    // Solicitação finalizada cujo contrato já foi encerrado (deleta/distrato)
    // não deve bloquear — o passo 1 já pegaria se estivesse ativo.
    if (s.status === "finalizada" && !s.contrato_id) continue;
    const sInicio = s.data_inicio ?? INFINITO_PASSADO;
    const sFim = s.data_termino ?? INFINITO_FUTURO;
    if (novoInicio <= sFim && sInicio <= novoFim) {
      const periodo =
        s.data_inicio && s.data_termino
          ? ` (${formatBr(s.data_inicio)} → ${formatBr(s.data_termino)})`
          : "";
      return {
        ok: false,
        message: `Este freela já tem solicitação em "${s.nome_job ?? "—"}"${periodo}, status ${s.status}. O período pedido se sobrepõe. Finalize/cancele antes de criar outra.`,
      };
    }
  }

  return { ok: true };
}

function formatBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
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

  // Renovação: chama RPC SECURITY DEFINER que cria contrato (resolvendo
  // nome do job sem passar pela RLS de empresa/regional), migra responsável
  // se necessário, e já sobe pra 'finalizada' quando for diária curta.
  // Antes era tudo inline em TS — mas isso dependia da RLS do usuário que
  // aprova, e caiu silenciosamente quando Erica aprovou jobs sem permissão
  // de SELECT em jobs (incidente Bruna/Raquel, 06/11/2026).
  if (solicitacao.freelancer_id) {
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "criar_contrato_de_renovacao",
      { p_solicitacao_id: id },
    );
    if (rpcErr) {
      console.error(
        "[solicitacao.aprovar.criar_contrato_rpc]",
        rpcErr.message,
      );
    } else if (Array.isArray(rpcData) && rpcData[0]?.finalizada) {
      await logAuditEvent({
        acao: "freelancer_solicitacao.finalizada_por_dispensa",
        tenantId: session.activeTenant.id,
        entidadeTipo: "freelancer_solicitacao",
        entidadeId: id,
        metadata: { contrato_id: rpcData[0]?.contrato_id ?? null },
      });
    }
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

  // Pros ids que viraram 'aprovada', chama a RPC pra cada renovação. A RPC
  // valida se tem freelancer_id (contratação pula), resolve nome do job
  // sem passar pela RLS de empresa/regional, cria contrato e sobe pra
  // 'finalizada' se for diária curta. Ver migration 20261106100001.
  const idsAprovados = (data ?? []).map((r: { id: string }) => r.id);
  if (idsAprovados.length > 0) {
    const { data: aprovadasData } = await supabase
      .from("freelancer_solicitacoes")
      .select("id, freelancer_id")
      .in("id", idsAprovados)
      .eq("tenant_id", session.activeTenant.id);
    for (const sol of (aprovadasData ?? []) as Array<{
      id: string;
      freelancer_id: string | null;
    }>) {
      if (!sol.freelancer_id) continue; // Contratação nova — aguarda freela
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "criar_contrato_de_renovacao",
        { p_solicitacao_id: sol.id },
      );
      if (rpcErr) {
        console.error(
          "[solicitacao.aprovar_lote.criar_contrato_rpc]",
          sol.id,
          rpcErr.message,
        );
        continue;
      }
      if (Array.isArray(rpcData) && rpcData[0]?.finalizada) {
        await logAuditEvent({
          acao: "freelancer_solicitacao.finalizada_por_dispensa",
          tenantId: session.activeTenant.id,
          entidadeTipo: "freelancer_solicitacao",
          entidadeId: sol.id,
          metadata: { contrato_id: rpcData[0]?.contrato_id ?? null },
        });
      }
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
