-- Security hardening: fecha dois buracos levantados pelos advisors do Supabase.
--
-- 1) REVOKE EXECUTE FROM anon em todas as funções public.*.
--    Advisor sinalizou 21 RPCs SECURITY DEFINER chamáveis por `anon`
--    (sem login), incluindo operações de negócio pesadas: aprovar_pp,
--    aprovar_desembolso_com_data, aplicar_fechamento_beneficios etc.
--    Como o app sempre chama via usuário autenticado (SUPABASE_ANON_KEY
--    só é usada pra "anon" ler o endpoint do PostgREST sem RPC privada),
--    nenhum caminho legítimo depende de EXECUTE pra anon. Trigger functions
--    rodam no contexto do owner, não precisam de GRANT pra anon.
--
-- 2) ALTER FUNCTION ... SET search_path pra as funções public.* sem
--    search_path explícito. Mitiga hijack via schema temporário.
--
-- EXCLUSÕES:
--  - Funções de extensão (unaccent) — não somos donos; ALTER falha com
--    42501. REVOKE também não aplicamos nelas pra manter o comportamento
--    público que a extensão espera (unaccent é só normalização de texto).
--
-- NÃO toca em views SECURITY DEFINER nesta migration — algumas (ex:
-- vw_dre_despesa_pessoal_ajustada_mensal) foram criadas DEFINER de
-- propósito e flipar pra INVOKER quebra DRE. Virará migration própria
-- depois de validar caso a caso.

-- =====================================================================
-- 1) REVOKE EXECUTE FROM anon (exceto funções de extensão)
-- =====================================================================
do $$
declare
  f record;
begin
  for f in
    select p.oid, n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f','p')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from anon',
      f.nspname, f.proname, f.args
    );
  end loop;
end $$;

-- =====================================================================
-- 2) ALTER FUNCTION ... SET search_path (exceto funções de extensão)
-- =====================================================================
do $$
declare
  f record;
begin
  for f in
    select p.oid, n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f','p')
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, pg_temp',
      f.nspname, f.proname, f.args
    );
  end loop;
end $$;
