-- =====================================================================
-- Task 001 — Hardening pós-migration (advisors)
--
-- Corrige avisos do Supabase Advisor:
--   - Fixa search_path da função de trigger set_updated_at.
--   - Revoga EXECUTE de PUBLIC/anon em todas as funções SECURITY DEFINER
--     do domínio de auth. anon nunca deve chamar essas funções via REST.
--   - Revoga EXECUTE de authenticated na trigger-only handle_new_user
--     (só o Postgres a chama, via trigger em auth.users).
--
-- Mantém EXECUTE para authenticated em:
--   - is_tenant_member / is_tenant_admin / current_tenant_ids /
--     current_profile_ativo — chamadas pelas policies RLS no contexto
--     do próprio usuário.
--   - log_audit_event — exposta intencionalmente para o cliente gravar
--     login/logout.
--
-- Nota: os avisos "Signed-In Users Can Execute SECURITY DEFINER Function"
-- que permanecerem para os helpers são falsos positivos aceitáveis — as
-- funções são projetadas para uso interno de RLS por authenticated e não
-- expõem dados sensíveis (retornam apenas boolean/uuid do próprio usuário).
-- =====================================================================

-- 1. Fixar search_path da trigger function set_updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 2. Revogar EXECUTE de PUBLIC e anon em funções SECURITY DEFINER
revoke execute on function public.current_profile_ativo() from public, anon;
revoke execute on function public.current_tenant_ids() from public, anon;
revoke execute on function public.is_tenant_member(uuid) from public, anon;
revoke execute on function public.is_tenant_admin(uuid) from public, anon;
revoke execute on function public.log_audit_event(text, uuid, text, text, jsonb) from public, anon;

-- 3. handle_new_user é trigger-only: revogar de todos os roles não-postgres.
--    Só o Postgres a invoca via trigger; ninguém deve conseguir chamá-la
--    diretamente via REST.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
