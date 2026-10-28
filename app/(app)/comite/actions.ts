"use server";

// Comitê de Aprovações (decisão 223): decidir, cancelar o envio e as regras.
// O pedido nasce nas telas de quem envia: `solicitarAprovacaoDaVersao`
// (versões) e `solicitarAprovacaoDaPP` (PPs a emitir). O banco guarda as
// transições (`comite_pedido_guarda`) e quem decide (`pode_decidir_no_comite`).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";
import { listActiveMembers } from "@/lib/data/members";
import { aprovarVersaoPeloComite } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/versoes/actions";
import type { RegrasDoComite } from "@/lib/calculos/limites-orcamento";

type Result = { ok: true } | { ok: false; message: string };

type Sessao = Awaited<ReturnType<typeof requireSession>>;
type Supabase = ReturnType<typeof createClient>;

async function podeDecidir(supabase: Supabase, tenantId: string): Promise<boolean> {
  const { data } = await supabase.rpc("pode_decidir_no_comite", { p_tenant_id: tenantId });
  return data === true;
}

async function negar(session: Sessao, acao: string, entidadeId: string | null) {
  await logAuditEvent({
    acao: "acao_negada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "comite_pedido",
    entidadeId,
    metadata: { acao_tentada: acao, motivo: "fora_do_comite" },
  });
}

interface PedidoAlvo {
  id: string;
  tipo: "versao" | "pp";
  status: string;
  enviado_por: string;
  orcamento_id: string | null;
  job_id: string | null;
  pp_a_emitir_id: string | null;
}

async function carregarPedido(supabase: Supabase, tenantId: string, pedidoId: string) {
  const { data } = await supabase
    .from("comite_pedidos")
    .select("id, tipo, status, enviado_por, orcamento_id, job_id, pp_a_emitir_id")
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<PedidoAlvo>();
  return data;
}

/** As telas de quem enviou, para mostrarem a decisão. */
async function revalidarOrigem(supabase: Supabase, p: PedidoAlvo) {
  if (p.tipo === "versao" && p.orcamento_id) {
    const { data } = await supabase
      .from("orcamentos")
      .select("projeto_id")
      .eq("id", p.orcamento_id)
      .maybeSingle<{ projeto_id: string }>();
    if (data) revalidatePath(`/orcamentos/${data.projeto_id}/${p.orcamento_id}`);
  }
  if (p.tipo === "pp" && p.job_id) revalidatePath(`/jobs/${p.job_id}`);
  revalidatePath("/comite");
}

/**
 * "Cancelar envio": quem enviou, ou quem poderia enviar (o GP da versão, a
 * produção da PP). A versão volta a ser editável; a PP a emitir, a ser
 * gerada ou enviada de novo.
 */
export async function cancelarEnvioAoComite(pedidoId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const pedido = await carregarPedido(supabase, tenantId, pedidoId);
  if (!pedido) return { ok: false, message: "Pedido não encontrado." };
  if (pedido.status !== "pendente") {
    return { ok: false, message: "Este pedido já foi decidido ou cancelado. Recarregue a página." };
  }
  const podeEnviar =
    pedido.tipo === "versao"
      ? pode(session.activeRole, "orcamentos.aprovar")
      : pode(session.activeRole, "jobs.emitir_pp");
  if (pedido.enviado_por !== session.profile.id && !podeEnviar) {
    await negar(session, "comite.cancelar_envio", pedidoId);
    return { ok: false, message: "Só quem enviou pode cancelar o envio." };
  }
  const { error } = await supabase
    .from("comite_pedidos")
    .update({ status: "cancelado" })
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("status", "pendente");
  if (error) {
    console.error("[comite.cancelar]", error.message);
    return { ok: false, message: "Não foi possível cancelar o envio." };
  }
  await logAuditEvent({
    acao: "comite.envio_cancelado",
    tenantId,
    entidadeTipo: "comite_pedido",
    entidadeId: pedidoId,
    metadata: { tipo: pedido.tipo },
  });
  await revalidarOrigem(supabase, pedido);
  return { ok: true };
}

/**
 * Aprovar: a versão é aprovada pelo Comitê (`aprovarVersaoPeloComite`); a
 * PP fica liberada para a produção gerar — o Comitê não gera a PP.
 */
export async function aprovarPedidoDoComite(pedidoId: string, comentario = ""): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  if (!(await podeDecidir(supabase, tenantId))) {
    await negar(session, "comite.aprovar", pedidoId);
    return { ok: false, message: "Só um membro do Comitê de Aprovações decide este pedido." };
  }
  const pedido = await carregarPedido(supabase, tenantId, pedidoId);
  if (!pedido) return { ok: false, message: "Pedido não encontrado." };
  if (pedido.status !== "pendente") {
    return { ok: false, message: "Este pedido já foi decidido ou cancelado. Recarregue a página." };
  }

  const texto = comentario.trim().slice(0, 2000) || null;
  if (pedido.tipo === "versao") {
    const res = await aprovarVersaoPeloComite(pedidoId, texto);
    if (!res.ok) return { ok: false, message: res.message };
    await revalidarOrigem(supabase, pedido);
    return { ok: true };
  }

  const { data: aEmitir } = await supabase
    .from("pedidos_compra_a_emitir")
    .select("id, pp_id, excluida_em")
    .eq("id", pedido.pp_a_emitir_id!)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; pp_id: string | null; excluida_em: string | null }>();
  if (!aEmitir || aEmitir.excluida_em) {
    return { ok: false, message: "A PP a emitir foi excluída. Recarregue a página." };
  }
  const { error } = await supabase
    .from("comite_pedidos")
    .update({ status: "aprovado", comentario: texto })
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("status", "pendente");
  if (error) {
    console.error("[comite.aprovar.pp]", error.message);
    return { ok: false, message: "Não foi possível registrar a aprovação." };
  }
  await logAuditEvent({
    acao: "comite.pedido_aprovado",
    tenantId,
    entidadeTipo: "comite_pedido",
    entidadeId: pedidoId,
    metadata: { tipo: "pp", pp_a_emitir_id: pedido.pp_a_emitir_id, job_id: pedido.job_id },
  });
  await revalidarOrigem(supabase, pedido);
  return { ok: true };
}

/** Devolver, com o comentário de quem decidiu (obrigatório). */
export async function devolverPedidoDoComite(pedidoId: string, comentario: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const texto = comentario.trim();
  if (!texto) return { ok: false, message: "Escreva o motivo da devolução." };
  if (texto.length > 2000) return { ok: false, message: "O motivo passou de 2.000 caracteres." };
  if (!(await podeDecidir(supabase, tenantId))) {
    await negar(session, "comite.devolver", pedidoId);
    return { ok: false, message: "Só um membro do Comitê de Aprovações decide este pedido." };
  }
  const pedido = await carregarPedido(supabase, tenantId, pedidoId);
  if (!pedido) return { ok: false, message: "Pedido não encontrado." };
  if (pedido.status !== "pendente") {
    return { ok: false, message: "Este pedido já foi decidido ou cancelado. Recarregue a página." };
  }
  const { error } = await supabase
    .from("comite_pedidos")
    .update({ status: "devolvido", comentario: texto })
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("status", "pendente");
  if (error) {
    console.error("[comite.devolver]", error.message);
    return { ok: false, message: "Não foi possível devolver o pedido." };
  }
  await logAuditEvent({
    acao: "comite.pedido_devolvido",
    tenantId,
    entidadeTipo: "comite_pedido",
    entidadeId: pedidoId,
    metadata: { tipo: pedido.tipo },
  });
  await revalidarOrigem(supabase, pedido);
  return { ok: true };
}

/* ---- Configurações ------------------------------------------------------- */

function numeroValido(n: number, min: number, max: number) {
  return Number.isFinite(n) && n >= min && n <= max;
}

export async function salvarRegrasDoComite(regras: RegrasDoComite): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  if (!(await podeDecidir(supabase, tenantId))) {
    await negar(session, "comite.regras", null);
    return { ok: false, message: "Só os membros do Comitê alteram as regras." };
  }
  if (!numeroValido(regras.resultadoMinimo, 0, 100)) {
    return { ok: false, message: "O resultado mínimo precisa ficar entre 0% e 100%." };
  }
  if (!numeroValido(regras.toleranciaValor, 0, 999_999_999)) {
    return { ok: false, message: "O valor da tolerância é inválido." };
  }
  if (!numeroValido(regras.toleranciaPct, 0, 100)) {
    return { ok: false, message: "O percentual da tolerância precisa ficar entre 0% e 100%." };
  }
  const { error } = await supabase.from("comite_config").upsert(
    {
      tenant_id: tenantId,
      resultado_ligado: regras.resultadoLigado,
      resultado_minimo: regras.resultadoMinimo,
      planejado_ligado: regras.planejadoLigado,
      pp_ligado: regras.ppLigado,
      linhas_vermelhas: regras.linhasVermelhas,
      tolerancia_ligada: regras.toleranciaLigada,
      tolerancia_valor: regras.toleranciaValor,
      tolerancia_pct: regras.toleranciaPct,
      admin_direto: regras.adminDireto,
      excecao_ligada: regras.excecaoLigada,
      atualizado_por: session.profile.id,
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    console.error("[comite.regras]", error.message);
    return { ok: false, message: "Não foi possível salvar as regras." };
  }
  await logAuditEvent({
    acao: "comite.regras_alteradas",
    tenantId,
    entidadeTipo: "comite_config",
    entidadeId: tenantId,
    metadata: { ...regras },
  });
  revalidatePath("/comite");
  return { ok: true };
}

export async function adicionarMembroDoComite(userId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  if (!(await podeDecidir(supabase, tenantId))) {
    await negar(session, "comite.membros", null);
    return { ok: false, message: "Só os membros do Comitê alteram a lista de membros." };
  }
  // Só quem é do tenant, ativo e não freelancer (a mesma régua de
  // `is_comite_membro`). A lista vem da RPC: a RLS de `tenant_members` só
  // mostra a própria linha a quem não é administrador.
  const [ativos, perfil] = await Promise.all([
    listActiveMembers(tenantId),
    supabase.from("profiles").select("role").eq("id", userId).maybeSingle<{ role: string | null }>(),
  ]);
  if (!ativos.some((m) => m.id === userId) || perfil.data?.role === "freelancer") {
    return { ok: false, message: "Escolha um usuário ativo do sistema." };
  }
  const { error } = await supabase
    .from("comite_membros")
    .insert({ tenant_id: tenantId, user_id: userId, adicionado_por: session.profile.id });
  if (error && error.code !== "23505") {
    console.error("[comite.membro.adicionar]", error.message);
    return { ok: false, message: "Não foi possível adicionar o membro." };
  }
  await logAuditEvent({
    acao: "comite.membro_adicionado",
    tenantId,
    entidadeTipo: "comite_membro",
    entidadeId: userId,
  });
  revalidatePath("/comite");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removerMembroDoComite(userId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  if (!(await podeDecidir(supabase, tenantId))) {
    await negar(session, "comite.membros", null);
    return { ok: false, message: "Só os membros do Comitê alteram a lista de membros." };
  }
  const { count } = await supabase
    .from("comite_membros")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if ((count ?? 0) <= 1) {
    return { ok: false, message: "O Comitê precisa de ao menos um membro." };
  }
  const { error } = await supabase
    .from("comite_membros")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) {
    console.error("[comite.membro.remover]", error.message);
    return { ok: false, message: "Não foi possível tirar o membro." };
  }
  await logAuditEvent({
    acao: "comite.membro_removido",
    tenantId,
    entidadeTipo: "comite_membro",
    entidadeId: userId,
  });
  revalidatePath("/comite");
  revalidatePath("/", "layout");
  return { ok: true };
}
