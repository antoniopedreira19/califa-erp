-- =====================================================================
-- Grants para o role service_role
--
-- CAUSA-RAIZ (encontrada ao tentar convidar usuário via /admin/usuarios):
--   service_role bypassa RLS mas NÃO bypassa GRANTs. As migrations da
--   Task 001 concederam privilégios só para `authenticated`, então a
--   primeira Server Action a usar `createServiceClient()` falhou com
--   `permission denied for table profiles` (42501). O próprio Postgres
--   sugeriu o remédio:
--     Grant the required privileges to the current role with:
--     GRANT SELECT ON public.profiles TO service_role;
--
--   Mesma classe de bug que atrasou o final da Task 001 (RLS ≠ GRANT).
--   Anotado para futuras tasks: toda tabela nova precisa de grant
--   explícito para authenticated E para service_role.
--
-- Estratégia:
--   1. Uso do schema public para service_role.
--   2. GRANT ALL em todas as tabelas/sequences já existentes.
--   3. ALTER DEFAULT PRIVILEGES para que tabelas/sequences criadas
--      futuramente (por qualquer role) já nasçam com grant.
--   4. EXECUTE em todas as funções (por completude — o service_role
--      pode precisar chamar helpers em Server Actions).
--
-- Segurança: dar ALL para service_role é o padrão do Supabase (é o role
-- que a Auth API usa internamente e que servidor-side actions usam para
-- operações administrativas). NUNCA expor essa key ao cliente.
-- =====================================================================

-- 1. Uso do schema.
grant usage on schema public to service_role;

-- 2. Privilégios totais nas tabelas e sequences existentes.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- 3. Default privileges: garante que objetos criados no futuro por
--    postgres/authenticator (roles usados pelas migrations do Supabase)
--    também deem grant automático a service_role, evitando repetir esse
--    bug em cada migration futura.
alter default privileges in schema public
  grant all privileges on tables to service_role;

alter default privileges in schema public
  grant all privileges on sequences to service_role;

-- 4. EXECUTE em todas as funções existentes (algumas são SECURITY DEFINER
--    com REVOKE de public na migration 002 — o REVOKE atinge apenas os
--    roles listados, mas dar grant explícito a service_role deixa a
--    intenção clara e evita surpresas).
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant execute on functions to service_role;
