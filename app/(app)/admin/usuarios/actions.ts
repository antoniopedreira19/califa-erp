"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { conviteSchema } from "@/lib/validations/convite";
import type { AppRole } from "@/lib/types";

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

  const { data: inviteData, error: inviteErr } =
    await service.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: nome ? { nome } : undefined,
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

  // Se o "nome" foi informado, atualiza o profile (o trigger usa o email como fallback).
  if (nome) {
    const { error: nameErr } = await service
      .from("profiles")
      .update({ nome })
      .eq("id", newUserId);
    if (nameErr) {
      console.warn("[admin.usuarios.convidar.update-nome]", nameErr.message);
    }
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
