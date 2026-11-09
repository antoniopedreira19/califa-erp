-- ============================================================================
-- RE-APONTA REFS NO SANDBOX PRO ANTONIO@SANDBOX E DELETA USERS DE TESTE
-- ============================================================================
-- Depois do move (970002), as 240+ referências a 1 user real (GP da
-- California que usou a Empresa Teste como ambiente pessoal de teste) e aos
-- 4 users de teste @califa-erp.local ficaram gravadas nos dados do sandbox.
-- Como o sandbox só tem antonio@sandbox como usuário, essas refs ficam
-- "órfãs" de permissão (user existe em profiles mas não tem tenant_member no
-- sandbox).
--
-- Decisão: re-apontar TODAS as refs de user_id nas linhas do sandbox pros 5
-- user_ids originais pro antonio@sandbox, uniformizando autoria aparente no
-- sandbox. O GP real segue existindo em prod intacto; só as refs no sandbox
-- trocam. Depois disso, os 4 users @califa-erp.local não têm mais pegada em
-- lugar nenhum → podem sair.
--
-- Depois do re-aponte, os 4 users @califa-erp.local são apagados:
--   - 4 tenant_members (em prod)
--   - 18 empresa_members (em prod)
--   - 4 profiles
--   - 4 auth.users
-- ============================================================================

set session_replication_role = replica;

do $$
declare
  v_tenant_sandbox uuid := 'db9278e5-1293-407f-bd33-d71b7061a849';
  v_antonio        uuid := '7a26c043-590b-44c8-91d8-293105603c47';
  v_tiago          uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_users_teste    uuid[] := ARRAY[
    '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a',  -- produtor_teste
    '72deafd9-16a3-461b-a1f1-b670fa9d2ba2',  -- claude.gp.teste
    '74a68c8b-53d9-43bd-ae0d-16c7cbbcb00b',  -- claude.produtor.teste
    '99b71b93-780a-40d5-9e37-62d563e696b6'   -- claude.freelancer.teste
  ]::uuid[];
  v_users_a_trocar uuid[];
  r record;
  v_sql text;
  v_count int;
  v_total int := 0;
begin
  v_users_a_trocar := array_append(v_users_teste, v_tiago);

  -- =========================================================================
  -- 1. Re-apontar refs dinamicamente: pra cada tabela base que tem tenant_id
  -- E tem alguma coluna de user_id, faz UPDATE filtrando por tenant=sandbox e
  -- user_id ∈ (GP real, 4 users teste) → antonio@sandbox.
  -- =========================================================================
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_name=c.table_name and t.table_schema=c.table_schema
    where c.table_schema='public'
      and t.table_type='BASE TABLE'
      and c.data_type='uuid'
      and (
        c.column_name ilike '%_by'
        or c.column_name ilike '%_por'
        or c.column_name='responsavel_id'
        or c.column_name='produtor_id'
        or c.column_name='actor_user_id'
        or c.column_name ilike '%_user_id'
      )
      -- Tabela precisa ter coluna tenant_id pra poder filtrar
      and exists (
        select 1 from information_schema.columns c2
        where c2.table_schema='public' and c2.table_name=c.table_name and c2.column_name='tenant_id'
      )
      -- Evita colunas "estruturais" de vínculo (user_id em tenant_members etc. não é autoria)
      and not (c.table_name='tenant_members' and c.column_name='user_id')
      and not (c.table_name='empresa_members' and c.column_name='user_id')
      and not (c.table_name='colaboradores'   and c.column_name='user_id')
      and not (c.table_name='comite_membros'  and c.column_name='user_id')
      and not (c.table_name='freelancer_solicitacao_mensagens_leituras' and c.column_name='user_id')
    loop
      v_sql := format(
        'update public.%I set %I = $1 where tenant_id = $2 and %I = any($3)',
        r.table_name, r.column_name, r.column_name
      );
      execute v_sql using v_antonio, v_tenant_sandbox, v_users_a_trocar;
      get diagnostics v_count = row_count;
      if v_count > 0 then
        raise notice '% . % : % linhas re-apontadas', r.table_name, r.column_name, v_count;
        v_total := v_total + v_count;
      end if;
    end loop;

  raise notice '=== Total de linhas re-apontadas: % ===', v_total;

  -- audit_events também, mesma lógica (actor_user_id)
  update audit_events set actor_user_id = v_antonio
  where tenant_id = v_tenant_sandbox and actor_user_id = any(v_users_a_trocar);
  get diagnostics v_count = row_count;
  raise notice 'audit_events . actor_user_id: % linhas', v_count;

  -- =========================================================================
  -- 2. Verificação: nenhum dos 5 user_ids deve aparecer mais em qualquer
  -- coluna de autoria no sandbox.
  -- =========================================================================
  select count(*) into v_count from jobs
    where tenant_id=v_tenant_sandbox
      and (responsavel_id = any(v_users_a_trocar)
           or produtor_id = any(v_users_a_trocar)
           or created_by = any(v_users_a_trocar)
           or aberto_por = any(v_users_a_trocar));
  if v_count > 0 then
    raise exception 'Jobs do sandbox ainda têm refs aos user_ids antigos: %', v_count;
  end if;

  -- =========================================================================
  -- 3. Delete dos 4 users @califa-erp.local (não ficou mais pegada deles)
  -- =========================================================================
  delete from empresa_members where user_id = any(v_users_teste);
  get diagnostics v_count = row_count;
  raise notice 'empresa_members dos users teste deletados: %', v_count;

  delete from tenant_members where user_id = any(v_users_teste);
  get diagnostics v_count = row_count;
  raise notice 'tenant_members dos users teste deletados: %', v_count;

  delete from profiles where id = any(v_users_teste);
  get diagnostics v_count = row_count;
  raise notice 'profiles dos users teste deletados: %', v_count;

  delete from auth.users where id = any(v_users_teste);
  get diagnostics v_count = row_count;
  raise notice 'auth.users dos users teste deletados: %', v_count;

  -- Verificação final: nenhum dos 4 users teste existe em lugar nenhum
  if exists (select 1 from profiles where id = any(v_users_teste)) then
    raise exception 'profiles dos users teste ainda existem';
  end if;
  if exists (select 1 from auth.users where id = any(v_users_teste)) then
    raise exception 'auth.users dos users teste ainda existem';
  end if;

  raise notice 'OK: re-aponte concluído e 4 users teste removidos';
end $$;

set session_replication_role = default;
