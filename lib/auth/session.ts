import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEmpresasByTenantCached } from "@/lib/data/empresas";
import type {
  AppRole,
  Empresa,
  Profile,
  SessionContext,
  Tenant,
  TenantMembership,
  TenantMemberStatus,
} from "@/lib/types";

type SessionResult =
  | { kind: "ok"; session: SessionContext }
  | { kind: "unauthenticated" }
  | { kind: "inativo"; profile: Profile }
  | { kind: "sem_tenant"; profile: Profile };

/**
 * Formato do JSONB retornado pela RPC public.get_session_context.
 * A RPC filtra internamente por auth.uid() (SECURITY DEFINER) e retorna
 * null quando não há usuário autenticado ou profile.
 */
interface SessionContextPayload {
  profile: Profile;
  memberships: Array<{
    role: AppRole;
    status: TenantMemberStatus;
    tenant: Tenant;
  }>;
}

/**
 * Carrega profile + memberships do usuário autenticado.
 *
 * Estratégia:
 *   1. Chama a RPC get_session_context (1 round-trip Postgres) que
 *      consolida o que antes eram 3 queries em série. A RPC lê
 *      auth.uid() do JWT no cookie, então não é preciso um auth.getUser
 *      separado aqui — o middleware já revalidou o token nesta request.
 *   2. Se a RPC retornar null → não há sessão válida no JWT.
 *
 * React.cache deduplica dentro do mesmo request server-side (múltiplos
 * server components chamando requireSession/loadSession compartilham o
 * mesmo resultado).
 *
 * Segurança: nenhum parâmetro é passado à RPC — o caller não consegue
 * pedir a sessão de outro usuário. A RPC filtra tudo por auth.uid().
 */
export const loadSession = cache(async (): Promise<SessionResult> => {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("get_session_context");

  if (error) {
    console.error("[session] rpc get_session_context falhou:", error.message);
    return { kind: "unauthenticated" };
  }

  if (!data) {
    // RPC retornou null: auth.uid() é null (sem JWT) ou o profile ainda
    // não foi criado (trigger handle_new_user pode não ter rodado).
    return { kind: "unauthenticated" };
  }

  const payload = data as SessionContextPayload;
  const { profile } = payload;

  if (!profile) {
    console.warn(
      "[session] rpc retornou sem profile — trigger handle_new_user pode não ter rodado",
    );
    return { kind: "unauthenticated" };
  }

  if (!profile.ativo) return { kind: "inativo", profile };

  const memberships: TenantMembership[] = (payload.memberships ?? [])
    .filter((m) => m.tenant && m.tenant.status === "ativo")
    .map((m) => ({
      role: m.role,
      status: m.status,
      tenant: m.tenant,
    }));

  if (memberships.length === 0) return { kind: "sem_tenant", profile };

  // MVP: tenant ativo = primeiro vínculo (só existe "Agência California").
  const active = memberships[0];

  // Empresas do tenant + resolução da empresa ativa via cookie.
  // Cache TTL 5min (tag "empresas") — invalidado pelas actions de
  // /admin/empresas ao criar/editar/desativar/reativar.
  const empresas = await getEmpresasByTenantCached(active.tenant.id);

  // Leitura dos cookies de empresa ativa.
  // NUNCA escrever cookies aqui — loadSession() roda em Server Components
  // e Next.js só permite writes em Server Actions / Route Handlers.
  //
  // Compat Fase 2A: se cookie antigo (`active_empresa_id`) existe e o novo
  // (`active_empresa_ids`) não, usa o antigo em modo somente-leitura. A
  // migração efetiva (apagar antigo, gravar novo) acontece quando o user
  // usa setActiveEmpresas (Server Action, pode escrever).
  const { cookies } = await import("next/headers");
  const cookieStore = cookies();
  const cookieNovo = cookieStore.get("active_empresa_ids")?.value;
  const cookieAntigo = cookieStore.get("active_empresa_id")?.value;
  const cookieEfetivo =
    cookieNovo && cookieNovo.length > 0 ? cookieNovo : (cookieAntigo ?? "");

  const idsSelecionados: string[] =
    cookieEfetivo.length > 0
      ? cookieEfetivo.split(",").filter((id) => id.length > 0)
      : [];

  // activeEmpresas = empresas do tenant que ainda existem E estão no cookie.
  // Ids que sumiram (empresa desativada, deletada) são ignorados silenciosamente.
  const activeEmpresas: Empresa[] = idsSelecionados
    .map((id) => empresas.find((e) => e.id === id))
    .filter((e): e is Empresa => e !== undefined);

  return {
    kind: "ok",
    session: {
      profile,
      memberships,
      activeTenant: active.tenant,
      activeRole: active.role,
      activeEmpresas,
      empresas,
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
