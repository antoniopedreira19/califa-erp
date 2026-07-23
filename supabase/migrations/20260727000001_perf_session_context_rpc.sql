-- =====================================================================
-- Perf: RPC get_session_context (consolida 3 queries em 1 round-trip)
--
-- Motivação: lib/auth/session.ts fazia 3 chamadas em série ao Supabase
-- (auth.getUser + select profiles + select tenant_members com join em
-- tenants), somando 400-800ms de Content Download em toda navegação.
-- Consolidar em uma RPC única corta pra 1 round-trip Postgres.
--
-- Segurança:
--   - SECURITY DEFINER: precisa validar sozinha o usuário via auth.uid().
--     Filtra profile e memberships por auth.uid() internamente — nunca
--     retorna dados de outro user, independente do argumento.
--   - Sem parâmetros: caller não pode influenciar qual user é
--     consultado. auth.uid() vem do JWT no cookie do request atual.
--   - set search_path = public: evita search_path hijacking.
--   - REVOKE FROM public (herança de 20260721000002) exige GRANT
--     EXECUTE explícito para authenticated. service_role coberto pelo
--     ALTER DEFAULT PRIVILEGES da migration 20260725000001.
--
-- Retorno: jsonb com {profile, memberships[]} ou NULL se não há user
-- ou profile. profile.ativo e length(memberships) permitem o caller
-- decidir estado (ativo/inativo/sem_tenant).
-- =====================================================================

create or replace function public.get_session_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_result jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'profile', to_jsonb(p),
    'memberships', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'role', tm.role,
            'status', tm.status,
            'tenant', to_jsonb(t)
          )
          order by tm.created_at
        )
        from public.tenant_members tm
        join public.tenants t on t.id = tm.tenant_id
        where tm.user_id = v_user_id
          and tm.status = 'ativo'
          and t.status = 'ativo'
      ),
      '[]'::jsonb
    )
  ) into v_result
  from public.profiles p
  where p.id = v_user_id;

  return v_result;
end;
$$;

-- REVOKE herdado de public em 20260721000002 exige grant explícito
-- para authenticated. service_role coberto por ALTER DEFAULT PRIVILEGES.
revoke execute on function public.get_session_context() from public, anon;
grant execute on function public.get_session_context() to authenticated;
