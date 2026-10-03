/**
 * Helpers compartilhados de convite/vínculo de usuários ao tenant.
 *
 * Esses blocos existem para o fluxo canônico de `/admin/usuarios` e o novo
 * fluxo de `/rh/colaboradores` reusarem a mesma lógica de banco (consultar
 * profile por email, enviar convite via Supabase Auth, criar membership)
 * sem duplicar.
 *
 * Projeto está separado em 3 funções em vez de 1 "faz tudo" porque o fluxo
 * do RH precisa **interromper** entre a verificação do email e a decisão de
 * convidar/vincular: se o email já tem profile, a UI pergunta ao usuário se
 * ele quer vincular ao profile existente antes de agir. Com um helper único,
 * essa pausa não cabe sem complicar a assinatura.
 *
 * Nenhuma dessas funções é um "use server" direto — são chamadas por server
 * actions. Elas assumem que o chamador já validou sessão + role.
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { AppRole, TenantMemberStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// 1. Verificar estado do email no tenant
// ---------------------------------------------------------------------------

export type EstadoEmail =
  | { tipo: "sem_profile" }
  | {
      tipo: "com_profile";
      profile_id: string;
      profile_nome: string;
      profile_email: string;
      e_membro_tenant: boolean;
      status_membership: TenantMemberStatus | null;
      role: AppRole | null;
    };

export type EstadoEmailResult =
  | { ok: true; estado: EstadoEmail }
  | { ok: false; mensagem: string };

/**
 * Dado um email, retorna se existe profile e, se existir, se já é membro
 * do tenant alvo (com role e status). Não modifica nada.
 */
export async function verificarEstadoEmailNoTenant(
  email: string,
  tenantId: string,
): Promise<EstadoEmailResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      mensagem:
        "Configuração do servidor incompleta (falta service_role key).",
    };
  }

  const service = createServiceClient();

  // profiles.email é case-insensitive na prática — usa ilike pra bater
  // com o auth.users.email que o GoTrue grava.
  const { data: profiles, error: profileErr } = await service
    .from("profiles")
    .select("id, nome, email")
    .ilike("email", email)
    .limit(1);

  if (profileErr) {
    console.error("[convidar.verificarEstadoEmail.profile]", profileErr.message);
    return { ok: false, mensagem: "Não foi possível verificar o email." };
  }

  const profile = profiles?.[0];
  if (!profile) {
    return { ok: true, estado: { tipo: "sem_profile" } };
  }

  const { data: member, error: memberErr } = await service
    .from("tenant_members")
    .select("role, status")
    .eq("tenant_id", tenantId)
    .eq("user_id", profile.id)
    .maybeSingle();

  if (memberErr) {
    console.error("[convidar.verificarEstadoEmail.member]", memberErr.message);
    return { ok: false, mensagem: "Não foi possível verificar o vínculo." };
  }

  return {
    ok: true,
    estado: {
      tipo: "com_profile",
      profile_id: profile.id as string,
      profile_nome: (profile.nome as string) ?? "",
      profile_email: (profile.email as string) ?? email,
      e_membro_tenant: !!member,
      status_membership: (member?.status as TenantMemberStatus | undefined) ?? null,
      role: (member?.role as AppRole | undefined) ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Enviar convite para email livre
// ---------------------------------------------------------------------------

export type EnvioConviteResult =
  | { ok: true; profile_id: string }
  | {
      ok: false;
      codigo:
        | "service_role_missing"
        | "ja_existe_profile"
        | "falha_smtp"
        | "email_rate_limit"
        | "falha_db";
      mensagem: string;
    };

/**
 * Envia convite via Supabase Auth. Assume que o email NÃO tem profile
 * (chamador deve ter verificado antes). O trigger `handle_new_user` vai
 * criar o profile automaticamente. A metadata do convite é lida pelo
 * trigger para popular `profiles.nome` e materializar permissões iniciais.
 *
 * NÃO cria `tenant_members` — isso é responsabilidade do caller via
 * `garantirMembershipTenant` após garantir o profile.
 */
export async function enviarConviteNovoUsuario(opts: {
  email: string;
  nome?: string;
  redirectTo: string;
  tenantId: string;
  /**
   * Metadata extra passada pro trigger handle_new_user. Admin pode mandar
   * escopo de empresas; RH convidando colaborador não precisa (bypass).
   */
  permissoesMetadata?: unknown;
}): Promise<EnvioConviteResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      codigo: "service_role_missing",
      mensagem:
        "Configuração do servidor incompleta (falta service_role key).",
    };
  }

  const service = createServiceClient();

  const inviteData: Record<string, unknown> = { tenant_id: opts.tenantId };
  if (opts.nome) inviteData.nome = opts.nome;
  if (opts.permissoesMetadata !== undefined) {
    inviteData.permissoes = opts.permissoesMetadata;
  }

  const { data, error } = await service.auth.admin.inviteUserByEmail(
    opts.email,
    { redirectTo: opts.redirectTo, data: inviteData },
  );

  if (error || !data?.user) {
    const msg = (error?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return {
        ok: false,
        codigo: "ja_existe_profile",
        mensagem:
          "Este email já tem conta no sistema — use o fluxo de vincular, não de convidar.",
      };
    }
    if (msg.includes("rate") || msg.includes("too many")) {
      return {
        ok: false,
        codigo: "email_rate_limit",
        mensagem: "Aguarde alguns segundos antes de reenviar o convite.",
      };
    }
    console.error("[convidar.enviarConvite]", error?.message ?? "sem user");
    return {
      ok: false,
      codigo: "falha_smtp",
      mensagem: "Não foi possível enviar o convite.",
    };
  }

  return { ok: true, profile_id: data.user.id };
}

// ---------------------------------------------------------------------------
// 3. Garantir membership (criar se não existe, reativar se inativo)
// ---------------------------------------------------------------------------

export type GarantirMembershipResult =
  | {
      ok: true;
      ja_era_membro_ativo: boolean;
      role_preservada: boolean;
      role_final: AppRole;
    }
  | {
      ok: false;
      codigo: "service_role_missing" | "falha_db";
      mensagem: string;
    };

/**
 * Garante que (user_id, tenant_id) existe em `tenant_members` com status
 * `ativo`. **Preserva a role existente** se o membership já existe — isso é
 * crucial pro fluxo de vinculação de colaborador a profile existente: o
 * profile pode ser um administrador do tenant que agora também vai ser
 * cadastrado como colaborador no RH, e NÃO podemos rebaixar a role dele.
 *
 * Comportamento:
 *  - Não existe membership → cria com `opts.role` + sincroniza profiles.role.
 *  - Existe inativo → reativa, mantém role existente, NÃO sincroniza.
 *  - Existe ativo → no-op (preserva tudo).
 *
 * Para alterar role de um membership existente, use função dedicada
 * (`alterarRoleColaborador` ou similar) com validação de last-admin lockout.
 * Esta função nunca rebaixa role.
 */
export async function garantirMembershipTenant(opts: {
  userId: string;
  tenantId: string;
  role: AppRole;
}): Promise<GarantirMembershipResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      codigo: "service_role_missing",
      mensagem:
        "Configuração do servidor incompleta (falta service_role key).",
    };
  }

  const service = createServiceClient();

  const { data: existente, error: selErr } = await service
    .from("tenant_members")
    .select("id, role, status")
    .eq("tenant_id", opts.tenantId)
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (selErr) {
    console.error("[convidar.garantirMembership.select]", selErr.message);
    return {
      ok: false,
      codigo: "falha_db",
      mensagem: "Não foi possível verificar o vínculo existente.",
    };
  }

  if (existente) {
    const jaEraMembroAtivo = existente.status === "ativo";
    const roleExistente = existente.role as AppRole;

    // Só reativa status se estava inativo. Nunca mexe na role existente.
    if (!jaEraMembroAtivo) {
      const { error: updErr } = await service
        .from("tenant_members")
        .update({ status: "ativo" })
        .eq("id", existente.id);
      if (updErr) {
        console.error("[convidar.garantirMembership.reativar]", updErr.message);
        return {
          ok: false,
          codigo: "falha_db",
          mensagem: "Falha ao reativar o vínculo existente.",
        };
      }
    }

    return {
      ok: true,
      ja_era_membro_ativo: jaEraMembroAtivo,
      role_preservada: true,
      role_final: roleExistente,
    };
  }

  // Novo membership: cria com role solicitada e sincroniza profiles.role.
  const { error: insErr } = await service.from("tenant_members").insert({
    tenant_id: opts.tenantId,
    user_id: opts.userId,
    role: opts.role,
    status: "ativo",
  });
  if (insErr) {
    console.error("[convidar.garantirMembership.insert]", insErr.message);
    return {
      ok: false,
      codigo: "falha_db",
      mensagem: "Falha ao criar o vínculo com o tenant.",
    };
  }

  // Sincroniza profiles.role apenas quando membership é novo (MVP 1-tenant).
  const { error: profErr } = await service
    .from("profiles")
    .update({ role: opts.role })
    .eq("id", opts.userId);
  if (profErr) {
    console.warn("[convidar.garantirMembership.sync-profile]", profErr.message);
  }

  return {
    ok: true,
    ja_era_membro_ativo: false,
    role_preservada: false,
    role_final: opts.role,
  };
}
