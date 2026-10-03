"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  verificarEstadoEmailNoTenant,
  enviarConviteNovoUsuario,
  garantirMembershipTenant,
} from "@/lib/auth/convidar";
import type { AppRole } from "@/lib/types";

type Result =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

type ConvidarResult =
  | { ok: true; cenario: "convite_enviado"; message: string }
  | {
      ok: false;
      codigo: "email_ja_tem_profile";
      profile_id: string;
      profile_nome: string;
      profile_email: string;
      message: string;
    }
  | { ok: false; codigo: "falha"; message: string };

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

const APP_ROLES = [
  "administrador",
  "gerente_producao",
  "financeiro",
  "produtor",
  "freelancer",
  "rh",
  "colaborador",
] as const;

const roleSchema = z.enum(APP_ROLES, {
  errorMap: () => ({ message: "Selecione um papel válido." }),
});

function resolveOrigin(): string {
  const h = headers();
  const forwardedHost = h.get("x-forwarded-host");
  const host = forwardedHost ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ??
    (host && host.startsWith("localhost") ? "http" : "https");
  if (!host) {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  }
  return `${proto}://${host}`;
}

async function carregarColaboradorEValidarGate(opts: {
  colaboradorId: string;
}): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      tenantId: string;
      colaborador: {
        id: string;
        nome: string;
        email: string | null;
        user_id: string | null;
        tenant_id: string;
      };
    }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) {
    return { ok: false, message: gate.message };
  }

  const service = createServiceClient();
  const { data: colab, error } = await service
    .from("colaboradores")
    .select("id, nome, email, user_id, tenant_id")
    .eq("id", opts.colaboradorId)
    .maybeSingle();

  if (error || !colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  if (colab.tenant_id !== session.activeTenant.id) {
    return { ok: false, message: "Colaborador não pertence a este tenant." };
  }

  return {
    ok: true,
    session,
    tenantId: session.activeTenant.id,
    colaborador: {
      id: colab.id as string,
      nome: colab.nome as string,
      email: (colab.email as string | null) ?? null,
      user_id: (colab.user_id as string | null) ?? null,
      tenant_id: colab.tenant_id as string,
    },
  };
}

// -------------------------------------------------------------------------
// 1. Convidar colaborador por email
// -------------------------------------------------------------------------

/**
 * Fluxo:
 * 1. Valida gate RH + carrega colaborador.
 * 2. Confere user_id IS NULL (idempotência).
 * 3. Se email passado difere do email cadastrado → atualiza também o
 *    colaboradores.email (sincronização §4.6 da spec).
 * 4. verificarEstadoEmailNoTenant:
 *    - Email tem profile → retorna 'email_ja_tem_profile' para UI
 *      perguntar se o usuário quer vincular.
 *    - Email livre → enviarConviteNovoUsuario + garantirMembership +
 *      UPDATE colaboradores.user_id.
 * 5. Audit event.
 */
export async function convidarColaborador(input: {
  colaborador_id: string;
  email: string;
  role: AppRole;
}): Promise<ConvidarResult> {
  const emailParsed = z
    .string()
    .trim()
    .toLowerCase()
    .email("Email inválido.")
    .safeParse(input.email);
  if (!emailParsed.success) {
    return {
      ok: false,
      codigo: "falha",
      message: emailParsed.error.errors[0]?.message ?? "Email inválido.",
    };
  }
  const emailNorm = emailParsed.data;

  const roleParsed = roleSchema.safeParse(input.role);
  if (!roleParsed.success) {
    return { ok: false, codigo: "falha", message: "Papel inválido." };
  }

  const ctx = await carregarColaboradorEValidarGate({
    colaboradorId: input.colaborador_id,
  });
  if (!ctx.ok) return { ok: false, codigo: "falha", message: ctx.message };

  const { session, tenantId, colaborador } = ctx;

  if (colaborador.user_id) {
    return {
      ok: false,
      codigo: "falha",
      message: "Esse colaborador já está vinculado a um usuário.",
    };
  }

  const service = createServiceClient();

  // Verifica estado do email no tenant
  const check = await verificarEstadoEmailNoTenant(emailNorm, tenantId);
  if (!check.ok) {
    return { ok: false, codigo: "falha", message: check.mensagem };
  }

  // Email já tem profile → devolve pra UI decidir
  if (check.estado.tipo === "com_profile") {
    return {
      ok: false,
      codigo: "email_ja_tem_profile",
      profile_id: check.estado.profile_id,
      profile_nome: check.estado.profile_nome,
      profile_email: check.estado.profile_email,
      message: `O email ${emailNorm} já tem conta no sistema (${check.estado.profile_nome}). Vincule em vez de convidar.`,
    };
  }

  // Email livre: envia convite
  const origin = resolveOrigin();
  const redirectTo = `${origin}/api/auth/callback?next=/definir-senha`;

  const envio = await enviarConviteNovoUsuario({
    email: emailNorm,
    nome: colaborador.nome,
    redirectTo,
    tenantId,
  });

  if (!envio.ok) {
    return { ok: false, codigo: "falha", message: envio.mensagem };
  }

  // Cria membership
  const membership = await garantirMembershipTenant({
    userId: envio.profile_id,
    tenantId,
    role: roleParsed.data,
  });
  if (!membership.ok) {
    return { ok: false, codigo: "falha", message: membership.mensagem };
  }

  // Atualiza colaborador: user_id + email (se mudou)
  const update: Record<string, unknown> = { user_id: envio.profile_id };
  if (emailNorm !== (colaborador.email ?? "").toLowerCase()) {
    update.email = emailNorm;
  }
  const { error: updColabErr } = await service
    .from("colaboradores")
    .update(update)
    .eq("id", colaborador.id);

  if (updColabErr) {
    console.error("[convidarColaborador.update-colab]", updColabErr.message);
    return {
      ok: false,
      codigo: "falha",
      message:
        "Convite enviado, mas falhamos ao vincular ao colaborador. Avise o dev.",
    };
  }

  await logAuditEvent({
    acao: "colaborador.convite_enviado",
    tenantId,
    entidadeTipo: "colaborador",
    entidadeId: colaborador.id,
    metadata: {
      email: emailNorm,
      role: roleParsed.data,
      user_id: envio.profile_id,
      actor_user_id: session.profile.id,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaborador.id}`);
  revalidatePath("/rh/colaboradores");

  return {
    ok: true,
    cenario: "convite_enviado",
    message: `Convite enviado para ${emailNorm}.`,
  };
}

// -------------------------------------------------------------------------
// 2. Vincular colaborador a profile existente (confirmação após 'email_ja_tem_profile')
// -------------------------------------------------------------------------

export async function vincularColaboradorAProfileExistente(input: {
  colaborador_id: string;
  profile_id: string;
  role: AppRole;
}): Promise<Result> {
  const roleParsed = roleSchema.safeParse(input.role);
  if (!roleParsed.success) {
    return { ok: false, message: "Papel inválido." };
  }

  const ctx = await carregarColaboradorEValidarGate({
    colaboradorId: input.colaborador_id,
  });
  if (!ctx.ok) return ctx;

  const { session, tenantId, colaborador } = ctx;

  if (colaborador.user_id) {
    return {
      ok: false,
      message: "Esse colaborador já está vinculado a um usuário.",
    };
  }

  const service = createServiceClient();

  // Checa unicidade do user_id: outro colaborador pode já estar vinculado
  // ao mesmo profile.
  const { data: outro, error: outroErr } = await service
    .from("colaboradores")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .eq("user_id", input.profile_id)
    .maybeSingle();

  if (outroErr) {
    console.error(
      "[vincularColaboradorAProfileExistente.check]",
      outroErr.message,
    );
    return { ok: false, message: "Falha ao verificar outros vínculos." };
  }

  if (outro) {
    return {
      ok: false,
      message: `Esse usuário já está vinculado ao colaborador ${outro.nome}.`,
    };
  }

  // Carrega email do profile pra sincronizar
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("id, email")
    .eq("id", input.profile_id)
    .maybeSingle();

  if (profileErr || !profile) {
    return { ok: false, message: "Usuário não encontrado." };
  }

  // Garante membership. Preserva role existente se o profile já é membro
  // (ex: vincular colaborador a um admin não rebaixa o admin).
  const membership = await garantirMembershipTenant({
    userId: input.profile_id,
    tenantId,
    role: roleParsed.data,
  });
  if (!membership.ok) {
    return { ok: false, message: membership.mensagem };
  }

  // Atualiza colaborador: user_id + email do profile
  const { error: updErr } = await service
    .from("colaboradores")
    .update({
      user_id: input.profile_id,
      email: (profile.email as string) ?? colaborador.email,
    })
    .eq("id", colaborador.id);

  if (updErr) {
    console.error(
      "[vincularColaboradorAProfileExistente.update]",
      updErr.message,
    );
    return { ok: false, message: "Falha ao vincular o colaborador." };
  }

  await logAuditEvent({
    acao: "colaborador.vinculado_a_usuario",
    tenantId,
    entidadeTipo: "colaborador",
    entidadeId: colaborador.id,
    metadata: {
      user_id: input.profile_id,
      role_solicitada: roleParsed.data,
      role_final: membership.role_final,
      role_preservada: membership.role_preservada,
      email_colaborador_anterior: colaborador.email,
      email_sincronizado: profile.email,
      actor_user_id: session.profile.id,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaborador.id}`);
  revalidatePath("/rh/colaboradores");

  const msg = membership.role_preservada
    ? `Colaborador vinculado. Papel existente (${membership.role_final}) foi preservado.`
    : "Colaborador vinculado ao usuário.";

  return { ok: true, message: msg };
}

// -------------------------------------------------------------------------
// 3. Reenviar convite
// -------------------------------------------------------------------------

export async function reenviarConviteColaborador(input: {
  colaborador_id: string;
}): Promise<Result> {
  const ctx = await carregarColaboradorEValidarGate({
    colaboradorId: input.colaborador_id,
  });
  if (!ctx.ok) return ctx;

  const { session, tenantId, colaborador } = ctx;

  if (!colaborador.user_id) {
    return {
      ok: false,
      message: "Colaborador não tem usuário vinculado.",
    };
  }

  const service = createServiceClient();
  const { data: userInfo, error: getErr } = await service.auth.admin.getUserById(
    colaborador.user_id,
  );

  if (getErr || !userInfo?.user?.email) {
    return { ok: false, message: "Usuário não encontrado." };
  }

  if (userInfo.user.last_sign_in_at) {
    return {
      ok: false,
      message: "Esse usuário já ativou a conta — não é preciso reenviar.",
    };
  }

  const origin = resolveOrigin();
  const redirectTo = `${origin}/api/auth/callback?next=/definir-senha`;

  const { error: inviteErr } = await service.auth.admin.inviteUserByEmail(
    userInfo.user.email,
    { redirectTo },
  );

  if (inviteErr) {
    const msg = inviteErr.message.toLowerCase();
    if (msg.includes("rate") || msg.includes("too many")) {
      return {
        ok: false,
        message: "Aguarde alguns segundos antes de reenviar.",
      };
    }
    console.error("[reenviarConviteColaborador]", inviteErr.message);
    return { ok: false, message: "Não foi possível reenviar o convite." };
  }

  await logAuditEvent({
    acao: "colaborador.convite_enviado",
    tenantId,
    entidadeTipo: "colaborador",
    entidadeId: colaborador.id,
    metadata: {
      reenvio: true,
      email: userInfo.user.email,
      actor_user_id: session.profile.id,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaborador.id}`);
  return { ok: true, message: "Convite reenviado." };
}

// -------------------------------------------------------------------------
// 4. Desvincular (zera user_id, mantém profile + membership)
// -------------------------------------------------------------------------

export async function desvincularColaborador(input: {
  colaborador_id: string;
}): Promise<Result> {
  const ctx = await carregarColaboradorEValidarGate({
    colaboradorId: input.colaborador_id,
  });
  if (!ctx.ok) return ctx;

  const { session, tenantId, colaborador } = ctx;

  if (!colaborador.user_id) {
    return { ok: true, message: "Colaborador já estava sem vínculo." };
  }

  const service = createServiceClient();
  const { error: updErr } = await service
    .from("colaboradores")
    .update({ user_id: null })
    .eq("id", colaborador.id);

  if (updErr) {
    console.error("[desvincularColaborador]", updErr.message);
    return { ok: false, message: "Falha ao desvincular." };
  }

  await logAuditEvent({
    acao: "colaborador.desvinculado",
    tenantId,
    entidadeTipo: "colaborador",
    entidadeId: colaborador.id,
    metadata: {
      user_id_removido: colaborador.user_id,
      actor_user_id: session.profile.id,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaborador.id}`);
  revalidatePath("/rh/colaboradores");
  return { ok: true, message: "Vínculo removido." };
}

// -------------------------------------------------------------------------
// 5. Alterar role do colaborador no tenant_members
// -------------------------------------------------------------------------

export async function alterarRoleColaborador(input: {
  colaborador_id: string;
  nova_role: AppRole;
}): Promise<Result> {
  const roleParsed = roleSchema.safeParse(input.nova_role);
  if (!roleParsed.success) {
    return { ok: false, message: "Papel inválido." };
  }

  const ctx = await carregarColaboradorEValidarGate({
    colaboradorId: input.colaborador_id,
  });
  if (!ctx.ok) return ctx;

  const { session, tenantId, colaborador } = ctx;

  if (!colaborador.user_id) {
    return {
      ok: false,
      message: "Colaborador sem vínculo — não há role pra alterar.",
    };
  }

  const service = createServiceClient();

  const { data: member, error: selErr } = await service
    .from("tenant_members")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", colaborador.user_id)
    .maybeSingle();

  if (selErr) {
    console.error("[alterarRoleColaborador.select]", selErr.message);
    return { ok: false, message: "Falha ao buscar o vínculo." };
  }
  if (!member) {
    return { ok: false, message: "Vínculo não encontrado no tenant." };
  }

  const roleAtual = member.role as AppRole;
  if (roleAtual === roleParsed.data) {
    return { ok: true, message: "Role já está definida." };
  }

  // Last-admin lockout
  if (roleAtual === "administrador") {
    const { count, error: countErr } = await service
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "administrador")
      .eq("status", "ativo");
    if (countErr) {
      return { ok: false, message: "Falha ao verificar administradores." };
    }
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        message:
          "Este é o último administrador ativo do tenant. Promova outro antes de rebaixar.",
      };
    }
  }

  const { error: updErr } = await service
    .from("tenant_members")
    .update({ role: roleParsed.data })
    .eq("id", member.id);

  if (updErr) {
    console.error("[alterarRoleColaborador.update]", updErr.message);
    return { ok: false, message: "Falha ao atualizar o papel." };
  }

  // Sincroniza profiles.role
  await service
    .from("profiles")
    .update({ role: roleParsed.data })
    .eq("id", colaborador.user_id);

  await logAuditEvent({
    acao: "colaborador.role_alterada",
    tenantId,
    entidadeTipo: "colaborador",
    entidadeId: colaborador.id,
    metadata: {
      user_id: colaborador.user_id,
      de: roleAtual,
      para: roleParsed.data,
      actor_user_id: session.profile.id,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaborador.id}`);
  return { ok: true, message: "Papel atualizado." };
}

// -------------------------------------------------------------------------
// 6. Buscar profiles para vinculação manual (search box)
// -------------------------------------------------------------------------

export type ProfileResumo = {
  id: string;
  nome: string;
  email: string;
};

export async function buscarProfilesParaVincular(input: {
  termo: string;
}): Promise<
  | { ok: true; profiles: ProfileResumo[] }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const termoNorm = input.termo.trim();
  if (termoNorm.length < 2) {
    return { ok: true, profiles: [] };
  }

  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  // Busca profiles com membership nesse tenant + que ainda não estão
  // vinculados a nenhum colaborador. Usa 2 queries e filtra no cliente
  // pq não há FK direta de colaboradores a profiles e o PostgREST não
  // ajuda nessa composição.
  const [{ data: profiles, error: profErr }, { data: vinculados }] =
    await Promise.all([
      service
        .from("profiles")
        .select("id, nome, email, tenant_members!inner(tenant_id, status)")
        .eq("tenant_members.tenant_id", tenantId)
        .eq("tenant_members.status", "ativo")
        .or(`nome.ilike.%${termoNorm}%,email.ilike.%${termoNorm}%`)
        .limit(50),
      service
        .from("colaboradores")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .not("user_id", "is", null),
    ]);

  if (profErr) {
    console.error("[buscarProfilesParaVincular]", profErr.message);
    return { ok: false, message: "Falha na busca." };
  }

  const idsJaVinculados = new Set(
    (vinculados ?? []).map((r) => r.user_id as string),
  );

  const livres = (profiles ?? [])
    .filter((p) => !idsJaVinculados.has(p.id as string))
    .slice(0, 20)
    .map((p) => ({
      id: p.id as string,
      nome: (p.nome as string) ?? "",
      email: (p.email as string) ?? "",
    }));

  return { ok: true, profiles: livres };
}

// -------------------------------------------------------------------------
// 7. Vinculação manual direta (busca → seleção)
// -------------------------------------------------------------------------

/**
 * Vincula colaborador a um profile escolhido manualmente na busca. Difere
 * de vincularColaboradorAProfileExistente apenas pelo audit event — essa
 * rota não veio de um convite bloqueado por email duplicado.
 */
export async function vincularColaboradorPorBusca(input: {
  colaborador_id: string;
  profile_id: string;
  role: AppRole;
}): Promise<Result> {
  // A lógica é idêntica — delega.
  return vincularColaboradorAProfileExistente(input);
}
