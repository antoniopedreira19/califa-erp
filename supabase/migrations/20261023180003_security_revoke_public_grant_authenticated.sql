-- Fix da migration 20261023180001: o REVOKE FROM anon não teve efeito nas
-- funções que tinham GRANT TO PUBLIC (default do Postgres), porque anon
-- herda qualquer coisa que seja PUBLIC. Resultado: as 49 funções com
-- `=X` no proacl continuaram chamáveis por anon via /rest/v1/rpc/*.
--
-- Esta migration faz:
--   1) REVOKE EXECUTE FROM PUBLIC em todas as funções public.* (exceto
--      extensões).
--   2) GRANT EXECUTE TO authenticated, service_role nas mesmas funções,
--      preservando o acesso legítimo via Supabase client logado e
--      via service role (server actions).
--
-- Trigger functions não precisam de GRANT a nenhum role de aplicação —
-- rodam no contexto do owner (postgres). Deixar o GRANT a authenticated
-- não quebra nada, só mantém o endpoint RPC acessível se algum lugar
-- do app chamar como RPC.

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
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public',
      f.nspname, f.proname, f.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to authenticated, service_role',
      f.nspname, f.proname, f.args
    );
  end loop;
end $$;
