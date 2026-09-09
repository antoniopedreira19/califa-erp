-- Motivo: Fase 2B — permissao explicita por empresa (e opcionalmente por
-- regional) para cada usuario do tenant. Ate agora, todo membro do
-- tenant enxergava todas as empresas do grupo. Esta migration cria a
-- tabela empresa_members, funcoes helpers reusaveis em RLS e code, e
-- triggers de integridade.
--
-- Aditivo: nenhuma tabela existente e modificada. RLS nas 13 tabelas
-- vem em migration separada (20260909000003) apos backfill.
--
-- Ver docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md

-- Tabela --------------------------------------------------------------
create table public.empresa_members (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  regional_id  uuid null references public.regionais(id) on delete cascade,
  status       public.tenant_member_status not null default 'ativo',
  created_by   uuid null references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_empresa_members
    unique nulls not distinct (user_id, empresa_id, regional_id)
);

comment on table  public.empresa_members is
  'Permissao de acesso de um usuario a uma empresa do tenant. regional_id NULL = acesso amplo a todas as regionais dessa empresa; quando preenchido, restringe as regionais listadas nas linhas.';
comment on column public.empresa_members.regional_id is
  'NULL = acesso amplo. Multiplas linhas com regional_id preenchido = restrito a essas regionais.';

alter table public.empresa_members enable row level security;

-- Grants
grant select, insert, update, delete on public.empresa_members to authenticated;
revoke all on public.empresa_members from anon;

-- updated_at automatico (funcao ja existe no projeto)
create trigger tr_empresa_members_updated_at
  before update on public.empresa_members
  for each row execute function public.set_updated_at();

-- Integridade: regional pertence a empresa da linha -------------------
create or replace function public.ck_empresa_members_regional_bate_empresa()
returns trigger language plpgsql
set search_path = public
as $$
declare v_empresa uuid;
begin
  if new.regional_id is null then return new; end if;
  select empresa_id into v_empresa from public.regionais where id = new.regional_id;
  if v_empresa is null then
    raise exception 'regional_id % nao existe', new.regional_id;
  end if;
  if v_empresa <> new.empresa_id then
    raise exception 'regional_id % pertence a empresa %, nao a % (empresa_id da linha)',
      new.regional_id, v_empresa, new.empresa_id;
  end if;
  return new;
end $$;

create trigger tr_empresa_members_regional_bate
  before insert or update of empresa_id, regional_id on public.empresa_members
  for each row execute function public.ck_empresa_members_regional_bate_empresa();

-- Integridade: por (user, empresa) OU tem linha regional=NULL (amplo)
-- OU tem N linhas com regional preenchida (restrito). Nunca as duas.
create or replace function public.ck_empresa_members_amplo_xor_restrito()
returns trigger language plpgsql
set search_path = public
as $$
declare v_amplo int; v_restrito int;
begin
  select
    count(*) filter (where regional_id is null),
    count(*) filter (where regional_id is not null)
  into v_amplo, v_restrito
  from public.empresa_members
  where user_id = new.user_id and empresa_id = new.empresa_id;

  if v_amplo > 0 and v_restrito > 0 then
    raise exception 'user % empresa %: nao pode ter acesso amplo (regional NULL) e restrito ao mesmo tempo',
      new.user_id, new.empresa_id;
  end if;
  return new;
end $$;

create trigger tr_empresa_members_amplo_xor_restrito
  after insert or update on public.empresa_members
  for each row execute function public.ck_empresa_members_amplo_xor_restrito();

-- Indices -------------------------------------------------------------
create index idx_empresa_members_user_empresa
  on public.empresa_members(user_id, empresa_id);
create index idx_empresa_members_user_status
  on public.empresa_members(user_id) where status = 'ativo';
create index idx_empresa_members_empresa_status
  on public.empresa_members(empresa_id) where status = 'ativo';

-- Funcao canonica — usada em RLS e code ------------------------------
create or replace function public.can_access_empresa_regional(
  p_user_id     uuid,
  p_empresa_id  uuid,
  p_regional_id uuid
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    -- Bypass: admin do tenant a que essa empresa pertence
    exists(
      select 1
      from public.tenant_members tm
      join public.empresas e on e.tenant_id = tm.tenant_id
      where tm.user_id = p_user_id
        and tm.role = 'administrador'
        and tm.status = 'ativo'
        and e.id = p_empresa_id
    )
    or
    -- Membership: user tem linha ativa na empresa E:
    -- (a) tabela sem regional (p_regional_id NULL) → basta acesso a empresa
    -- (b) user tem acesso amplo (regional_id NULL na membership) OU
    -- (c) user tem linha com regional_id igual a essa
    exists(
      select 1 from public.empresa_members em
      where em.user_id = p_user_id
        and em.empresa_id = p_empresa_id
        and em.status = 'ativo'
        and (
          p_regional_id is null
          or em.regional_id is null
          or em.regional_id = p_regional_id
        )
    );
$$;

comment on function public.can_access_empresa_regional is
  'Fonte-verdade da checagem. Admin do tenant bypassa. Para tabelas sem regional, passe p_regional_id=NULL (short-circuit apos empresa).';

revoke all on function public.can_access_empresa_regional(uuid, uuid, uuid) from anon, public;
grant execute on function public.can_access_empresa_regional(uuid, uuid, uuid) to authenticated;

-- Helper: empresas visiveis pelo user autenticado ---------------------
create or replace function public.empresas_visiveis_do_user(p_user_id uuid)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select e.id from public.empresas e
  join public.tenant_members tm on tm.tenant_id = e.tenant_id
  where tm.user_id = p_user_id
    and tm.role = 'administrador'
    and tm.status = 'ativo'
    and e.ativo = true
  union
  select distinct em.empresa_id from public.empresa_members em
  where em.user_id = p_user_id and em.status = 'ativo';
$$;

revoke all on function public.empresas_visiveis_do_user(uuid) from anon, public;
grant execute on function public.empresas_visiveis_do_user(uuid) to authenticated;

-- Helper: pares (empresa, regional) visiveis
create or replace function public.regionais_visiveis_do_user(p_user_id uuid)
returns table(empresa_id uuid, regional_id uuid)
language sql stable security definer
set search_path = public
as $$
  -- Admin: todas as empresas x todas as regionais delas
  select e.id, r.id
  from public.empresas e
  join public.tenant_members tm on tm.tenant_id = e.tenant_id
  left join public.regionais r on r.empresa_id = e.id and r.ativo = true
  where tm.user_id = p_user_id
    and tm.role = 'administrador'
    and tm.status = 'ativo'
    and e.ativo = true
  union
  -- Membership amplo: (empresa, cada regional dela)
  select em.empresa_id, r.id
  from public.empresa_members em
  left join public.regionais r on r.empresa_id = em.empresa_id and r.ativo = true
  where em.user_id = p_user_id
    and em.status = 'ativo'
    and em.regional_id is null
  union
  -- Membership restrito: pares exatos
  select em.empresa_id, em.regional_id
  from public.empresa_members em
  where em.user_id = p_user_id
    and em.status = 'ativo'
    and em.regional_id is not null;
$$;

revoke all on function public.regionais_visiveis_do_user(uuid) from anon, public;
grant execute on function public.regionais_visiveis_do_user(uuid) to authenticated;

-- RLS: policy da propria tabela ---------------------------------------
create policy empresa_members_select_owner
  on public.empresa_members for select to authenticated
  using (
    user_id = auth.uid()
    or is_tenant_admin(tenant_id)
  );

create policy empresa_members_admin_insert
  on public.empresa_members for insert to authenticated
  with check (is_tenant_admin(tenant_id));

create policy empresa_members_admin_update
  on public.empresa_members for update to authenticated
  using (is_tenant_admin(tenant_id))
  with check (is_tenant_admin(tenant_id));

create policy empresa_members_admin_delete
  on public.empresa_members for delete to authenticated
  using (is_tenant_admin(tenant_id));
