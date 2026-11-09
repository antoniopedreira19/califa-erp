-- ============================================================================
-- SANDBOX: SÓ ANTONIO@SANDBOX.COM.BR TEM ACESSO
-- ============================================================================
-- Racional: a migration de clone (20261109960001_clone_tenant_rh_sandbox.sql)
-- copiou os 108 tenant_members e 402 empresa_members do tenant California pro
-- tenant Sandbox, dando acesso de login ao sandbox pros 107 colaboradores reais.
-- A decisão agora é que o Sandbox serve só pra validação interna: só o usuário
-- antonio@sandbox.com.br (user_id 7a26c043-590b-44c8-91d8-293105603c47) fica,
-- com acesso amplo à empresa "Agência California" dentro do sandbox.
--
-- O que faz:
--   1. DELETE em empresa_members do sandbox (402 linhas → 0): nenhum empresa_members
--      do sandbox é usado pra lógica de negócio (sandbox não tem dado operacional).
--   2. DELETE em tenant_members do sandbox onde user_id<>antonio_sandbox (107 → 1).
--   3. INSERT 1 linha em empresa_members pro antonio_sandbox → "Agência California"
--      do tenant sandbox (empresa_id 4ecf2d9a-ecf9-4e76-895d-2719b0cf2c38),
--      regional_id=NULL (acesso amplo).
--
-- session_replication_role = replica: igual ao clone, pra não poluir audit_events
-- com 509 linhas de delete + insert; é operação administrativa, não evento de
-- negócio. Também evita triggers de validação que recusariam a reversão.
-- ============================================================================

set session_replication_role = replica;

do $$
declare
  v_tenant_sandbox        uuid := 'db9278e5-1293-407f-bd33-d71b7061a849';
  v_user_antonio_sandbox  uuid := '7a26c043-590b-44c8-91d8-293105603c47';
  v_empresa_cal_sandbox   uuid := '4ecf2d9a-ecf9-4e76-895d-2719b0cf2c38';
  v_deleted_em            int;
  v_deleted_tm            int;
  v_inserted_em           int;
begin

  -- Pré-checagens defensivas
  if not exists (select 1 from tenants where id = v_tenant_sandbox and slug = 'california-sandbox') then
    raise exception 'Tenant sandbox (%) não encontrado ou slug divergente', v_tenant_sandbox;
  end if;

  if not exists (select 1 from auth.users where id = v_user_antonio_sandbox) then
    raise exception 'User antonio@sandbox (%) não encontrado em auth.users', v_user_antonio_sandbox;
  end if;

  if not exists (
    select 1 from tenant_members
    where tenant_id = v_tenant_sandbox and user_id = v_user_antonio_sandbox and role = 'administrador'
  ) then
    raise exception 'antonio@sandbox precisa estar como administrador no tenant_members do sandbox ANTES desta migration';
  end if;

  if not exists (
    select 1 from empresas where id = v_empresa_cal_sandbox and tenant_id = v_tenant_sandbox
  ) then
    raise exception 'Empresa Agência California do sandbox (%) não encontrada', v_empresa_cal_sandbox;
  end if;

  -- 1. Limpa empresa_members do sandbox (todos)
  delete from empresa_members
  where tenant_id = v_tenant_sandbox;
  get diagnostics v_deleted_em = row_count;
  raise notice 'empresa_members deletados do sandbox: %', v_deleted_em;

  -- 2. Limpa tenant_members do sandbox, exceto o antonio@sandbox
  delete from tenant_members
  where tenant_id = v_tenant_sandbox
    and user_id <> v_user_antonio_sandbox;
  get diagnostics v_deleted_tm = row_count;
  raise notice 'tenant_members deletados do sandbox (exceto antonio): %', v_deleted_tm;

  -- 3. Cria empresa_members do antonio@sandbox → Agência California (sandbox)
  insert into empresa_members (
    id, tenant_id, user_id, empresa_id, regional_id, status, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_tenant_sandbox,
    v_user_antonio_sandbox,
    v_empresa_cal_sandbox,
    null,              -- NULL = acesso amplo a todas as regionais dessa empresa
    'ativo',
    now(),
    now()
  );
  get diagnostics v_inserted_em = row_count;
  raise notice 'empresa_members inseridos pro antonio@sandbox: %', v_inserted_em;

  -- Pós-verificação
  perform 1 from tenant_members where tenant_id = v_tenant_sandbox having count(*) = 1;
  if not found then
    raise exception 'Pós-condição falhou: sandbox deveria ter 1 tenant_member, tem %',
      (select count(*) from tenant_members where tenant_id = v_tenant_sandbox);
  end if;

  perform 1 from empresa_members where tenant_id = v_tenant_sandbox having count(*) = 1;
  if not found then
    raise exception 'Pós-condição falhou: sandbox deveria ter 1 empresa_member, tem %',
      (select count(*) from empresa_members where tenant_id = v_tenant_sandbox);
  end if;

  raise notice 'OK: sandbox agora tem exatamente 1 tenant_member (antonio@sandbox) e 1 empresa_member (Agência California, regional_id NULL)';
end $$;

set session_replication_role = default;
