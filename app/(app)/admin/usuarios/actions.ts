"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { conviteSchema } from "@/lib/validations/convite";
import type { AppRole } from "@/lib/types";

const APP_ROLES = [
  "administrador",
  "gerente_producao",
  "financeiro",
  "produtor",
  "freelancer",
  "rh",
] as const;

const roleSchema = z.enum(APP_ROLES, {
  errorMap: () => ({ message: "Selecione um papel válido." }),
});

export type ActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    email: formData.get("email")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    role: (formData.get("role")?.toString() ?? "") as AppRole,
  };
}

/**
 * Resolve o origin da aplicação a partir dos headers do request atual.
 * Prefere x-forwarded-host (Vercel/proxy) e cai em host + protocolo detectado.
 */
function resolveOrigin(): string {
  const h = headers();
  const forwardedHost = h.get("x-forwarded-host");
  const host = forwardedHost ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ??
    (host && host.startsWith("localhost") ? "http" : "https");
  if (!host) {
    // Fallback: env var pública se um dia precisarmos. Nunca deve chegar aqui.
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  }
  return `${proto}://${host}`;
}

/**
 * Convida um novo usuário para o tenant ativo.
 *
 * Fluxo:
 * 1. Valida sessão + admin.
 * 2. Verifica se já existe profile com esse e-mail:
 *    - Se sim e já é membro do tenant → erro amigável.
 *    - Se sim mas sem vínculo no tenant → cria só o vínculo (sem novo convite).
 * 3. Se não existe: chama admin.inviteUserByEmail (service client) com
 *    redirectTo = <origin>/api/auth/callback?next=/definir-senha.
 *    O trigger handle_new_user cria o profile automaticamente.
 * 4. Insere row em tenant_members com role escolhida (service client, bypassa
 *    RLS — a autorização já foi feita por requireAdmin).
 * 5. Loga auditoria.
 */
export async function convidarUsuario(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = conviteSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, nome, role } = parsed.data;
  const tenantId = session.activeTenant.id;

  // Guard-rail: sem a service_role key não dá pra convidar (a query abaixo
  // vai falhar com erro genérico e o admin não sabe por quê).
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[admin.usuarios.convidar] SUPABASE_SERVICE_ROLE_KEY ausente no ambiente.",
    );
    return {
      ok: false,
      message:
        "Configuração do servidor incompleta (falta service_role key). Fale com o dev.",
    };
  }

  const service = createServiceClient();

  // 1) Já existe profile com esse e-mail?
  //
  // Usamos ilike em vez de eq porque profiles.email é gravado como o
  // auth.users.email traz — case-insensitive na prática — e o zod já
  // normaliza pra lowercase o input do form. Também usamos limit(1) +
  // array em vez de maybeSingle() para não estourar erro caso alguém
  // tenha inserido duplicata durante testes.
  const { data: existingProfiles, error: profileErr } = await service
    .from("profiles")
    .select("id, nome, email")
    .ilike("email", email)
    .limit(1);

  if (profileErr) {
    console.error(
      "[admin.usuarios.convidar.select-profile]",
      JSON.stringify({
        message: profileErr.message,
        code: profileErr.code,
        details: profileErr.details,
        hint: profileErr.hint,
      }),
    );
    return { ok: false, message: "Não foi possível verificar o e-mail." };
  }

  const existingProfile = existingProfiles?.[0] ?? null;

  // 1a) Se já é membro deste tenant, bloqueia.
  if (existingProfile) {
    const { data: existingMember, error: memberErr } = await service
      .from("tenant_members")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();

    if (memberErr) {
      console.error(
        "[admin.usuarios.convidar.select-member]",
        JSON.stringify({
          message: memberErr.message,
          code: memberErr.code,
          details: memberErr.details,
          hint: memberErr.hint,
        }),
      );
      return { ok: false, message: "Não foi possível verificar o vínculo." };
    }

    if (existingMember) {
      return {
        ok: false,
        message:
          existingMember.status === "ativo"
            ? "Este e-mail já é membro do tenant."
            : "Este e-mail já tem vínculo (inativo) com o tenant — reative pela lista.",
      };
    }

    // 1b) Existe profile mas sem vínculo: só cria a membership.
    const { error: insertErr } = await service
      .from("tenant_members")
      .insert({
        tenant_id: tenantId,
        user_id: existingProfile.id,
        role,
        status: "ativo",
      });

    if (insertErr) {
      console.error("[admin.usuarios.convidar.insert-member]", insertErr.message);
      return {
        ok: false,
        message: "Não foi possível criar o vínculo com o tenant.",
      };
    }

    // Mantém profiles.role em sincronia com o vínculo criado (MVP tem 1
    // tenant por usuário — usar a role escolhida como default do profile
    // evita divergência visual quando se olha a tabela profiles direto).
    const { error: syncErr } = await service
      .from("profiles")
      .update({ role })
      .eq("id", existingProfile.id);
    if (syncErr) {
      console.warn(
        "[admin.usuarios.convidar.sync-profile-role]",
        syncErr.message,
      );
    }

    await logAuditEvent({
      acao: "usuario.membership_criada",
      tenantId,
      entidadeTipo: "tenant_member",
      entidadeId: existingProfile.id,
      metadata: { email, role, ja_tinha_conta: true },
    });

    revalidatePath("/admin/usuarios");
    return {
      ok: true,
      message:
        "Usuário já existia no sistema — vinculamos ao tenant sem enviar novo convite.",
    };
  }

  // 2) Não existe profile: envia invite.
  const origin = resolveOrigin();
  const redirectTo = `${origin}/api/auth/callback?next=/definir-senha`;

  // Monta metadata de permissoes (Fase 2B). O trigger handle_new_user le
  // raw_user_meta_data.permissoes ao aceitar o convite e materializa as
  // linhas de empresa_members. Formato esperado pelo trigger:
  //   { escopo: "todas" }
  //   { escopo: "personalizado", empresas: [{ empresa_id, regionais: null | uuid[] }] }
  // "regionais": null = amplo pra essa empresa. Nao usar a string "all"
  // no metadata (o trigger espera JSON null).
  const escopoConvite = (formData.get("escopo_empresas")?.toString() ??
    "todas") as "todas" | "personalizado";
  const escolhidasRaw = formData.get("empresas_escolhidas")?.toString();
  let permissoesMetadata: {
    escopo: "todas" | "personalizado";
    empresas?: Array<{ empresa_id: string; regionais: string[] | null }>;
  } = { escopo: escopoConvite };

  if (escopoConvite === "personalizado" && escolhidasRaw) {
    try {
      const parsed = JSON.parse(escolhidasRaw) as Array<{
        empresaId: string;
        regionais: "all" | string[];
      }>;
      permissoesMetadata = {
        escopo: "personalizado",
        empresas: parsed.map((e) => ({
          empresa_id: e.empresaId,
          regionais: e.regionais === "all" ? null : e.regionais,
        })),
      };
    } catch {
      return {
        ok: false,
        message: "Formato inválido em empresas escolhidas.",
      };
    }
  }

  // Admin do tenant tem bypass automatico — nao materializa empresa_members.
  const inviteData_: Record<string, unknown> = {
    tenant_id: tenantId,
    permissoes: permissoesMetadata,
  };
  if (nome) inviteData_.nome = nome;

  const { data: inviteData, error: inviteErr } =
    await service.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: inviteData_,
    });

  if (inviteErr || !inviteData?.user) {
    console.error(
      "[admin.usuarios.convidar.invite]",
      inviteErr?.message ?? "sem user",
    );
    const msg = inviteErr?.message ?? "";
    if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
      return {
        ok: false,
        message: "Este e-mail já está registrado. Verifique a lista de usuários.",
      };
    }
    return {
      ok: false,
      message: "Não foi possível enviar o convite. Tente novamente.",
    };
  }

  const newUserId = inviteData.user.id;

  // Atualiza o profile recém-criado pelo trigger handle_new_user:
  // - `nome` (opcional): sobrescreve o fallback do split de e-mail.
  // - `role`: o trigger grava 'gerente_producao' hardcoded; sincronizamos
  //   com a role escolhida no drawer pra bater com tenant_members.role.
  const profileUpdate: Record<string, unknown> = { role };
  if (nome) profileUpdate.nome = nome;

  const { error: updProfileErr } = await service
    .from("profiles")
    .update(profileUpdate)
    .eq("id", newUserId);
  if (updProfileErr) {
    console.warn(
      "[admin.usuarios.convidar.update-profile]",
      updProfileErr.message,
    );
  }

  // 3) Cria vínculo com o tenant.
  const { error: memberErr } = await service.from("tenant_members").insert({
    tenant_id: tenantId,
    user_id: newUserId,
    role,
    status: "ativo",
  });

  if (memberErr) {
    console.error("[admin.usuarios.convidar.insert-member]", memberErr.message);
    // Não deu pra vincular — o user existe em auth mas não vai conseguir usar o ERP.
    // Manter mensagem clara para o admin agir manualmente.
    return {
      ok: false,
      message:
        "Convite enviado, mas falhamos ao criar o vínculo com o tenant. Complete manualmente.",
    };
  }

  await logAuditEvent({
    acao: "usuario.convidado",
    tenantId,
    entidadeTipo: "tenant_member",
    entidadeId: newUserId,
    metadata: { email, role, redirectTo },
  });

  revalidatePath("/admin/usuarios");
  return { ok: true, id: newUserId, message: "Convite enviado com sucesso." };
}

/**
 * Reenvia o convite de acesso para um usuário que ainda não confirmou o e-mail.
 *
 * Fluxo:
 * 1. Valida sessão + admin.
 * 2. Confirma que o `userId` é membro do tenant ativo (impede admin reenviar
 *    convite para usuário de outro tenant, mesmo sabendo o id).
 * 3. Puxa o auth.user pelo service client e confere que `email_confirmed_at`
 *    ainda é null — se já confirmou, não faz sentido reenviar convite.
 * 4. Chama `inviteUserByEmail` de novo: o GoTrue regenera o token e envia
 *    e-mail novo com o mesmo redirectTo do convite original.
 * 5. Loga auditoria `usuario.reenvio_convite`.
 */
export async function reenviarConvite(userId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const tenantId = session.activeTenant.id;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[admin.usuarios.reenviar] SUPABASE_SERVICE_ROLE_KEY ausente no ambiente.",
    );
    return {
      ok: false,
      message:
        "Configuração do servidor incompleta (falta service_role key). Fale com o dev.",
    };
  }

  if (typeof userId !== "string" || userId.length === 0) {
    return { ok: false, message: "ID do usuário inválido." };
  }

  const service = createServiceClient();

  const { data: member, error: memberErr } = await service
    .from("tenant_members")
    .select("id, user_id, status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) {
    console.error(
      "[admin.usuarios.reenviar.select-member]",
      memberErr.message,
    );
    return { ok: false, message: "Não foi possível verificar o vínculo." };
  }

  if (!member) {
    return { ok: false, message: "Usuário não pertence a este tenant." };
  }

  const { data: userInfo, error: getUserErr } =
    await service.auth.admin.getUserById(userId);

  if (getUserErr || !userInfo?.user) {
    console.error(
      "[admin.usuarios.reenviar.get-user]",
      getUserErr?.message ?? "sem user",
    );
    return { ok: false, message: "Não foi possível encontrar o usuário." };
  }

  const authUser = userInfo.user;
  // Bloqueia reenvio só se o usuário JÁ logou pelo menos uma vez. Não basta
  // ter email_confirmed_at preenchido: se ele clicou no link mas nunca terminou
  // de definir senha, `email_confirmed_at` é setado pelo callback mas
  // `last_sign_in_at` fica null — nesse estado ele NÃO consegue entrar e
  // precisa de convite novo.
  if (authUser.last_sign_in_at) {
    return {
      ok: false,
      message:
        "Este usuário já ativou a conta — não é preciso reenviar convite.",
    };
  }
  if (!authUser.email) {
    return { ok: false, message: "Usuário sem e-mail cadastrado." };
  }

  const origin = resolveOrigin();
  const redirectTo = `${origin}/api/auth/callback?next=/definir-senha`;

  const { error: inviteErr } = await service.auth.admin.inviteUserByEmail(
    authUser.email,
    { redirectTo },
  );

  if (inviteErr) {
    console.error("[admin.usuarios.reenviar.invite]", inviteErr.message);
    const msg = inviteErr.message.toLowerCase();
    if (msg.includes("rate") || msg.includes("too many")) {
      return {
        ok: false,
        message: "Aguarde alguns segundos antes de reenviar de novo.",
      };
    }
    return { ok: false, message: "Não foi possível reenviar o convite." };
  }

  await logAuditEvent({
    acao: "usuario.reenvio_convite",
    tenantId,
    entidadeTipo: "tenant_member",
    entidadeId: userId,
    metadata: { email: authUser.email, redirectTo },
  });

  revalidatePath("/admin/usuarios");
  return { ok: true, message: "Convite reenviado." };
}

/**
 * Retorna as permissoes atuais de um usuario (empresas + regionais) no
 * tenant ativo. Usado pelo drawer de edicao para hidratar o estado inicial.
 */
export interface CarregarPermissoesResult {
  ok: true;
  escopo: "todas" | "personalizado";
  empresas: Array<{ empresa_id: string; regionais: "all" | string[] }>;
}

export async function carregarPermissoes(
  userId: string,
): Promise<CarregarPermissoesResult | { ok: false; message: string }> {
  const session = await requireAdmin();
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  const { data: rows, error } = await service
    .from("empresa_members")
    .select("empresa_id, regional_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("status", "ativo");

  if (error) {
    console.error("[admin.usuarios.carregarPermissoes]", error.message);
    return { ok: false, message: "Não foi possível carregar as permissões." };
  }

  const { data: empresasTenant } = await service
    .from("empresas")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true);

  const empresaIdsDoTenant = new Set(
    (empresasTenant ?? []).map((e) => e.id as string),
  );

  const porEmpresa: Record<string, "all" | Set<string>> = {};
  for (const r of rows ?? []) {
    const empresaId = r.empresa_id as string;
    if (r.regional_id === null) {
      porEmpresa[empresaId] = "all";
    } else {
      const atual = porEmpresa[empresaId];
      if (atual === "all") continue;
      if (atual instanceof Set) atual.add(r.regional_id as string);
      else porEmpresa[empresaId] = new Set([r.regional_id as string]);
    }
  }

  const empresas = Object.entries(porEmpresa).map(([empresa_id, regs]) => ({
    empresa_id,
    regionais: (regs === "all" ? "all" : Array.from(regs)) as "all" | string[],
  }));

  const todasCobertas =
    empresas.length === empresaIdsDoTenant.size &&
    empresas.every((e) => e.regionais === "all");

  return {
    ok: true,
    escopo: todasCobertas ? "todas" : "personalizado",
    empresas,
  };
}

/**
 * Substitui as permissoes de um usuario no tenant ativo.
 *
 * Fluxo:
 * 1. Valida admin.
 * 2. Se escopo=todas, expande em uma linha 'all' por empresa ativa do tenant.
 * 3. Delete tudo do user no tenant, insert novo estado.
 * 4. Auditoria + revalidateTag do user-permissions.
 *
 * Ruling: fazemos delete+insert em series (sem transacao) porque o cliente
 * Supabase nao expoe BEGIN/COMMIT fora de RPC. Se o insert falhar depois
 * do delete, o admin perde as permissoes atuais — mensagem clara pra ele
 * refazer. E o cenario esperado e insert simples.
 */
export async function atualizarPermissoes(
  userId: string,
  escopo: "todas" | "personalizado",
  empresasEscolhidas: Array<{
    empresa_id: string;
    regionais: "all" | string[];
  }>,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  if (typeof userId !== "string" || userId.length === 0) {
    return { ok: false, message: "ID do usuário inválido." };
  }

  let entradas = empresasEscolhidas;
  if (escopo === "todas") {
    const { data: empresasTenant, error: empErr } = await service
      .from("empresas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true);
    if (empErr) {
      console.error(
        "[admin.usuarios.atualizarPermissoes.list-empresas]",
        empErr.message,
      );
      return { ok: false, message: "Não foi possível carregar empresas." };
    }
    entradas = (empresasTenant ?? []).map((e) => ({
      empresa_id: e.id as string,
      regionais: "all" as const,
    }));
  }

  const { error: delErr } = await service
    .from("empresa_members")
    .delete()
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (delErr) {
    console.error(
      "[admin.usuarios.atualizarPermissoes.delete]",
      delErr.message,
    );
    return { ok: false, message: "Falha ao limpar permissões anteriores." };
  }

  const toInsert: Array<{
    tenant_id: string;
    user_id: string;
    empresa_id: string;
    regional_id: string | null;
    status: "ativo";
    created_by: string;
  }> = [];
  for (const e of entradas) {
    if (e.regionais === "all") {
      toInsert.push({
        tenant_id: tenantId,
        user_id: userId,
        empresa_id: e.empresa_id,
        regional_id: null,
        status: "ativo",
        created_by: session.profile.id,
      });
    } else {
      for (const r of e.regionais) {
        toInsert.push({
          tenant_id: tenantId,
          user_id: userId,
          empresa_id: e.empresa_id,
          regional_id: r,
          status: "ativo",
          created_by: session.profile.id,
        });
      }
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await service
      .from("empresa_members")
      .insert(toInsert);
    if (insErr) {
      console.error(
        "[admin.usuarios.atualizarPermissoes.insert]",
        insErr.message,
      );
      return { ok: false, message: "Falha ao salvar permissões." };
    }
  }

  await logAuditEvent({
    acao: "empresa_member.atualizado",
    tenantId,
    entidadeTipo: "user",
    entidadeId: userId,
    metadata: { escopo, empresas: entradas },
  });

  revalidateTag(`user-permissions:${userId}`);
  revalidatePath("/admin/usuarios");
  revalidatePath("/admin/empresas");

  return { ok: true, message: "Permissões atualizadas." };
}

/**
 * Altera o papel (role) de um usuário dentro do tenant ativo.
 *
 * Regras de segurança:
 * 1. requireAdmin — só admin pode chamar.
 * 2. Escopo por tenant — update é filtrado por tenant_id + user_id, para
 *    evitar que admin de um tenant altere papel de usuário de outro.
 * 3. Validação do valor com zod contra o enum AppRole.
 * 4. Last-admin lockout — se a mudança tirar o último administrador ativo
 *    do tenant, bloqueia com mensagem clara.
 * 5. Auditoria com valor antes e depois.
 *
 * Mantém `profiles.role` em sincronia com `tenant_members.role` — MVP tem
 * 1 tenant por usuário, mesmo padrão do fluxo de convite.
 */
export async function atualizarPapel(
  userId: string,
  novaRole: AppRole,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const tenantId = session.activeTenant.id;

  if (typeof userId !== "string" || userId.length === 0) {
    return { ok: false, message: "ID do usuário inválido." };
  }

  const parsed = roleSchema.safeParse(novaRole);
  if (!parsed.success) {
    return { ok: false, message: "Selecione um papel válido." };
  }
  const role = parsed.data;

  const service = createServiceClient();

  const { data: member, error: memberErr } = await service
    .from("tenant_members")
    .select("id, role, status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) {
    console.error(
      "[admin.usuarios.atualizarPapel.select-member]",
      memberErr.message,
    );
    return { ok: false, message: "Não foi possível verificar o vínculo." };
  }

  if (!member) {
    return { ok: false, message: "Usuário não pertence a este tenant." };
  }

  const papelAtual = member.role as AppRole;

  if (papelAtual === role) {
    return { ok: true, message: "Papel já está definido." };
  }

  // Last-admin lockout: se está saindo de administrador, garante que sobra
  // pelo menos um administrador ativo no tenant.
  if (papelAtual === "administrador") {
    const { count, error: countErr } = await service
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "administrador")
      .eq("status", "ativo");

    if (countErr) {
      console.error(
        "[admin.usuarios.atualizarPapel.count-admins]",
        countErr.message,
      );
      return {
        ok: false,
        message: "Não foi possível verificar o número de administradores.",
      };
    }

    const adminsAtivos = count ?? 0;
    const alvoContaComoAdmin = member.status === "ativo" ? 1 : 0;
    if (adminsAtivos - alvoContaComoAdmin < 1) {
      return {
        ok: false,
        message:
          "Este é o último administrador ativo do tenant. Promova outro usuário a administrador antes de rebaixar este.",
      };
    }
  }

  const { error: updMemberErr } = await service
    .from("tenant_members")
    .update({ role })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  if (updMemberErr) {
    console.error(
      "[admin.usuarios.atualizarPapel.update-member]",
      updMemberErr.message,
    );
    return { ok: false, message: "Falha ao atualizar o papel." };
  }

  const { error: updProfileErr } = await service
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (updProfileErr) {
    console.warn(
      "[admin.usuarios.atualizarPapel.sync-profile-role]",
      updProfileErr.message,
    );
  }

  await logAuditEvent({
    acao: "usuario.papel_alterado",
    tenantId,
    entidadeTipo: "tenant_member",
    entidadeId: userId,
    metadata: { de: papelAtual, para: role },
  });

  revalidateTag(`user-permissions:${userId}`);
  revalidatePath("/admin/usuarios");

  return { ok: true, message: "Papel atualizado." };
}

/**
 * Ativa ou inativa o vínculo (tenant_members) de um usuário no tenant ativo.
 *
 * "Inativar" aqui = remover o acesso ao ERP sem apagar a conta. A RPC
 * `get_session_context` já filtra por `tenant_members.status = 'ativo'`, então
 * o próximo request do usuário inativado cai em `sem_tenant` e é redirecionado
 * pelo `requireSession`. Reativar restaura o acesso sem re-convite.
 *
 * NÃO mexemos em `profiles.ativo` — esse campo tem escopo global (afeta todos
 * os tenants futuros) e representa "conta desativada no sistema", uma decisão
 * diferente de "não faz mais parte deste tenant".
 *
 * Regras de segurança:
 * 1. requireAdmin.
 * 2. Escopo por tenant.
 * 3. Não pode inativar a si mesmo (evita auto-lockout do próprio admin).
 * 4. Last-admin lockout ao inativar administrador (mesma regra de
 *    `atualizarPapel`).
 */
export async function alterarStatusMembership(
  userId: string,
  novoStatus: "ativo" | "inativo",
): Promise<ActionResult> {
  const session = await requireAdmin();
  const tenantId = session.activeTenant.id;

  if (typeof userId !== "string" || userId.length === 0) {
    return { ok: false, message: "ID do usuário inválido." };
  }

  if (novoStatus !== "ativo" && novoStatus !== "inativo") {
    return { ok: false, message: "Status inválido." };
  }

  if (userId === session.profile.id && novoStatus === "inativo") {
    return {
      ok: false,
      message: "Você não pode inativar seu próprio acesso.",
    };
  }

  const service = createServiceClient();

  const { data: member, error: memberErr } = await service
    .from("tenant_members")
    .select("id, role, status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) {
    console.error(
      "[admin.usuarios.alterarStatus.select-member]",
      memberErr.message,
    );
    return { ok: false, message: "Não foi possível verificar o vínculo." };
  }

  if (!member) {
    return { ok: false, message: "Usuário não pertence a este tenant." };
  }

  const statusAtual = member.status as "ativo" | "inativo";
  if (statusAtual === novoStatus) {
    return { ok: true, message: "Status já está definido." };
  }

  // Last-admin lockout: inativar um admin não pode deixar o tenant sem admin
  // ativo.
  if (
    novoStatus === "inativo" &&
    (member.role as AppRole) === "administrador"
  ) {
    const { count, error: countErr } = await service
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "administrador")
      .eq("status", "ativo");

    if (countErr) {
      console.error(
        "[admin.usuarios.alterarStatus.count-admins]",
        countErr.message,
      );
      return {
        ok: false,
        message: "Não foi possível verificar o número de administradores.",
      };
    }

    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        message:
          "Este é o último administrador ativo do tenant. Promova outro usuário a administrador antes de inativar este.",
      };
    }
  }

  const { error: updErr } = await service
    .from("tenant_members")
    .update({ status: novoStatus })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  if (updErr) {
    console.error("[admin.usuarios.alterarStatus.update]", updErr.message);
    return { ok: false, message: "Falha ao atualizar o status." };
  }

  await logAuditEvent({
    acao: "tenant_member.status_alterado",
    tenantId,
    entidadeTipo: "tenant_member",
    entidadeId: userId,
    metadata: { de: statusAtual, para: novoStatus },
  });

  revalidateTag(`user-permissions:${userId}`);
  revalidatePath("/admin/usuarios");

  return {
    ok: true,
    message: novoStatus === "inativo" ? "Usuário inativado." : "Usuário reativado.",
  };
}
