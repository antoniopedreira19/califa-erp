-- =====================================================================
-- Task 001 — GRANTs para o role authenticated
--
-- CAUSA-RAIZ ENCONTRADA na iteração de debug:
--   RLS é filtro adicional, não substituto do sistema de GRANTs do
--   Postgres. Sem GRANT SELECT/INSERT nas tabelas, o role `authenticated`
--   recebe `permission denied` antes mesmo do RLS ser consultado.
--   Isso quebrava `getSessionContext()`: profile e memberships voltavam
--   como null, requireSession redirecionava para /login, middleware
--   redirecionava de volta para /dashboard, loop.
--
--   Também: `revoke execute ... from public` em 002_hardening tirou
--   EXECUTE dos helpers RLS também de `authenticated` (que herdava de
--   PUBLIC). Preciso re-conceder explicitamente.
--
-- Regra geral desta task:
--   - `authenticated` recebe grants mínimos (SELECT/UPDATE/INSERT
--     conforme o caso). RLS restringe QUAIS linhas, GRANTs autorizam o
--     verbo em si.
--   - `anon` NÃO recebe nenhum grant nas tabelas de negócio.
-- =====================================================================

-- 1. Uso do schema
grant usage on schema public to authenticated;

-- 2. tenants — só leitura para authenticated; escrita via service_role.
grant select on public.tenants to authenticated;

-- 3. profiles — leitura e update do próprio profile (nome).
--    role/ativo não podem ser alterados pelo cliente (protegido em
--    Server Action com service_role em tasks futuras).
grant select, update on public.profiles to authenticated;

-- 4. tenant_members — só leitura para authenticated. Escrita de vínculo
--    é ato administrativo, feita via service_role.
grant select on public.tenant_members to authenticated;

-- 5. audit_events — leitura (RLS filtra por self/admin) e INSERT (RLS
--    valida actor_user_id = auth.uid()).
grant select, insert on public.audit_events to authenticated;

-- 6. EXECUTE nos helpers de RLS (revogados de PUBLIC em 002, precisam
--    ser re-concedidos explicitamente para authenticated).
grant execute on function public.current_profile_ativo() to authenticated;
grant execute on function public.current_tenant_ids() to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid) to authenticated;

-- 7. log_audit_event já tinha grant explícito na migration 001, mas
--    reafirmar por segurança (idempotente).
grant execute on function public.log_audit_event(text, uuid, text, text, jsonb) to authenticated;
