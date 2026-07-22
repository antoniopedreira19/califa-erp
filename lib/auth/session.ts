import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  AppRole,
  Profile,
  SessionContext,
  Tenant,
  TenantMembership,
} from "@/lib/types";

type SessionResult =
  | { kind: "ok"; session: SessionContext }
  | { kind: "unauthenticated" }
  | { kind: "inativo"; profile: Profile }
  | { kind: "sem_tenant"; profile: Profile };

/**
 * Carrega profile + memberships do usuário autenticado.
 * Retorna um discriminated union para que o caller reaja apropriadamente
 * a cada estado — nunca silencia erros do Supabase.
 * React.cache deduplica dentro do mesmo request server-side.
 */
export const loadSession = cache(async (): Promise<SessionResult> => {
  const supabase = createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr) {
    console.error("[session] auth.getUser falhou:", userErr.message);
    return { kind: "unauthenticated" };
  }
  if (!user) return { kind: "unauthenticated" };

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (profileErr) {
    // Erro real (RLS, GRANT, coluna faltando etc). Loga para diagnóstico.
    console.error("[session] SELECT profiles falhou:", profileErr.message);
    return { kind: "unauthenticated" };
  }
  if (!profile) {
    console.warn(
      "[session] profile não encontrado para user_id",
      user.id,
      "(trigger handle_new_user pode não ter rodado)",
    );
    return { kind: "unauthenticated" };
  }

  if (!profile.ativo) return { kind: "inativo", profile };

  const { data: rawMemberships, error: memErr } = await supabase
    .from("tenant_members")
    .select("role, status, tenant:tenants(*)")
    .eq("user_id", user.id)
    .eq("status", "ativo");

  if (memErr) {
    console.error("[session] SELECT tenant_members falhou:", memErr.message);
    return { kind: "sem_tenant", profile };
  }

  const memberships: TenantMembership[] = (rawMemberships ?? [])
    .map((row: any) => ({
      role: row.role as AppRole,
      status: row.status,
      tenant: row.tenant as Tenant,
    }))
    .filter((m) => m.tenant && m.tenant.status === "ativo");

  if (memberships.length === 0) return { kind: "sem_tenant", profile };

  // MVP: tenant ativo = primeiro vínculo (só existe "Agência California").
  const active = memberships[0];

  return {
    kind: "ok",
    session: {
      profile,
      memberships,
      activeTenant: active.tenant,
      activeRole: active.role,
    },
  };
});

/**
 * Compat: retorna SessionContext ou null. Preferir loadSession() para
 * distinguir os motivos.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const result = await loadSession();
  return result.kind === "ok" ? result.session : null;
}

/**
 * Garante sessão válida. Em qualquer estado inválido, faz signOut + redirect.
 * O signOut é feito ANTES do redirect para invalidar o cookie e evitar loop
 * com o middleware.
 */
export async function requireSession(): Promise<SessionContext> {
  const result = await loadSession();

  switch (result.kind) {
    case "ok":
      return result.session;

    case "unauthenticated":
      redirect("/login");

    case "inativo": {
      const supabase = createClient();
      await supabase.auth.signOut();
      redirect("/login?reason=inativo");
    }

    case "sem_tenant": {
      const supabase = createClient();
      await supabase.auth.signOut();
      redirect("/login?reason=sem_tenant");
    }
  }
}

export async function requireAdmin(): Promise<SessionContext> {
  const ctx = await requireSession();
  if (ctx.activeRole !== "administrador") redirect("/home");
  return ctx;
}
