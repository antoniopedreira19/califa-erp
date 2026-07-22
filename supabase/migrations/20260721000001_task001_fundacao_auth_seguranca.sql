-- =====================================================================
-- Task 001 — Fundação, Auth e Segurança
--
-- Cria a base multi-tenant do ERP California:
--   - tenants (empresa/organização dona dos dados)
--   - profiles (perfil de aplicação vinculado ao Supabase Auth)
--   - tenant_members (vínculo usuário <-> tenant com role)
--   - audit_events (trilha append-only de eventos sensíveis)
--
-- Regras:
--   - Toda tabela operacional tem tenant_id (fronteira de segurança).
--   - RLS obrigatório em todas as tabelas.
--   - Usuário só acessa dados de tenants em que possui vínculo ativo.
--   - profiles.ativo = false bloqueia acesso ao sistema.
--   - audit_events é append-only para papéis não-administradores.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensões e schema
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Enums de domínio
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tenant_status') then
    create type public.tenant_status as enum ('ativo', 'inativo');
  end if;

  if not exists (select 1 from pg_type where typname = 'app_role') then
    -- Papéis iniciais do MVP (docs/02-seguranca-auth-rls.md).
    create type public.app_role as enum ('administrador', 'gestao_projetos', 'financeiro');
  end if;

  if not exists (select 1 from pg_type where typname = 'tenant_member_status') then
    create type public.tenant_member_status as enum ('ativo', 'inativo');
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 2. Trigger de updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Tabela tenants
-- ---------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  status public.tenant_status not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Tabela profiles
--    id === auth.users.id (1:1 com Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  role public.app_role not null default 'gestao_projetos',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_ativo on public.profiles(ativo);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 5. Tabela tenant_members
--    Vínculo usuário <-> tenant com role dentro do tenant.
-- ---------------------------------------------------------------------
create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'gestao_projetos',
  status public.tenant_member_status not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists idx_tenant_members_tenant on public.tenant_members(tenant_id);
create index if not exists idx_tenant_members_user on public.tenant_members(user_id);
create index if not exists idx_tenant_members_status on public.tenant_members(status);

drop trigger if exists trg_tenant_members_updated_at on public.tenant_members;
create trigger trg_tenant_members_updated_at
before update on public.tenant_members
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. Tabela audit_events (append-only na prática)
-- ---------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  acao text not null,
  entidade_tipo text,
  entidade_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_tenant on public.audit_events(tenant_id);
create index if not exists idx_audit_events_actor on public.audit_events(actor_user_id);
create index if not exists idx_audit_events_acao on public.audit_events(acao);
create index if not exists idx_audit_events_created_at on public.audit_events(created_at desc);

-- ---------------------------------------------------------------------
-- 7. Helpers de autorização (SECURITY DEFINER para escapar do RLS
--    dentro de subqueries de policies, evitando recursão)
-- ---------------------------------------------------------------------

-- Retorna true se o usuário autenticado tem profile ativo.
create or replace function public.current_profile_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.ativo from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- IDs dos tenants em que o usuário atual tem vínculo ativo.
create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.tenant_id
  from public.tenant_members tm
  join public.profiles p on p.id = tm.user_id
  where tm.user_id = auth.uid()
    and tm.status = 'ativo'
    and p.ativo = true;
$$;

-- É membro ativo do tenant específico?
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.user_id = auth.uid()
      and tm.tenant_id = p_tenant_id
      and tm.status = 'ativo'
      and p.ativo = true
  );
$$;

-- É administrador do tenant específico?
create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.user_id = auth.uid()
      and tm.tenant_id = p_tenant_id
      and tm.status = 'ativo'
      and tm.role = 'administrador'
      and p.ativo = true
  );
$$;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------

-- tenants
alter table public.tenants enable row level security;

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
for select
to authenticated
using (public.is_tenant_member(id));

-- Insert/update/delete de tenants é operação administrativa;
-- no MVP, só via service role (Server Actions).
drop policy if exists tenants_admin_write on public.tenants;
create policy tenants_admin_write on public.tenants
for all
to authenticated
using (public.is_tenant_admin(id))
with check (public.is_tenant_admin(id));

-- profiles
alter table public.profiles enable row level security;

-- Usuário sempre pode ler o próprio profile.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
for select
to authenticated
using (id = auth.uid());

-- Administrador de qualquer tenant do usuário pode ver membros do mesmo tenant.
drop policy if exists profiles_select_same_tenant on public.profiles;
create policy profiles_select_same_tenant on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm_self
    join public.tenant_members tm_other on tm_other.tenant_id = tm_self.tenant_id
    where tm_self.user_id = auth.uid()
      and tm_self.status = 'ativo'
      and tm_self.role = 'administrador'
      and tm_other.user_id = profiles.id
      and tm_other.status = 'ativo'
  )
);

-- Usuário pode atualizar apenas o próprio nome; role/ativo não podem ser
-- alterados via cliente (protegido em Server Action com service_role).
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- tenant_members
alter table public.tenant_members enable row level security;

-- Usuário vê o próprio vínculo.
drop policy if exists tenant_members_select_self on public.tenant_members;
create policy tenant_members_select_self on public.tenant_members
for select
to authenticated
using (user_id = auth.uid());

-- Administrador do tenant vê todos os vínculos daquele tenant.
drop policy if exists tenant_members_select_admin on public.tenant_members;
create policy tenant_members_select_admin on public.tenant_members
for select
to authenticated
using (public.is_tenant_admin(tenant_id));

-- Escrita apenas por administrador do tenant.
drop policy if exists tenant_members_admin_write on public.tenant_members;
create policy tenant_members_admin_write on public.tenant_members
for all
to authenticated
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

-- audit_events: append-only na prática.
alter table public.audit_events enable row level security;

-- Administrador do tenant lê os eventos.
drop policy if exists audit_events_select_admin on public.audit_events;
create policy audit_events_select_admin on public.audit_events
for select
to authenticated
using (
  tenant_id is not null and public.is_tenant_admin(tenant_id)
);

-- Usuário lê os próprios eventos (para telas de "minha atividade").
drop policy if exists audit_events_select_self on public.audit_events;
create policy audit_events_select_self on public.audit_events
for select
to authenticated
using (actor_user_id = auth.uid());

-- Inserção: qualquer usuário autenticado pode inserir SEUS PRÓPRIOS
-- eventos no tenant do qual é membro ativo. Isto permite auditar
-- login/logout a partir do cliente autenticado.
drop policy if exists audit_events_insert_self on public.audit_events;
create policy audit_events_insert_self on public.audit_events
for insert
to authenticated
with check (
  actor_user_id = auth.uid()
  and (tenant_id is null or public.is_tenant_member(tenant_id))
);

-- Sem update/delete: append-only.

-- ---------------------------------------------------------------------
-- 9. Trigger de bootstrap de profile a partir de auth.users
--    Quando um usuário é criado no Supabase Auth, cria automaticamente
--    o registro em public.profiles usando o metadata do signup.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email, role, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'gestao_projetos',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 10. RPC de auditoria (Server Actions / API Routes chamam por esta RPC)
-- ---------------------------------------------------------------------
create or replace function public.log_audit_event(
  p_acao text,
  p_tenant_id uuid default null,
  p_entidade_tipo text default null,
  p_entidade_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'log_audit_event exige usuário autenticado';
  end if;

  insert into public.audit_events (
    tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata
  )
  values (
    p_tenant_id, auth.uid(), p_acao, p_entidade_tipo, p_entidade_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

grant execute on function public.log_audit_event(text, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Seed: tenant inicial Agência California
--     Slug fixo permite idempotência.
-- ---------------------------------------------------------------------
insert into public.tenants (nome, slug, status)
values ('Agência California', 'agencia-california', 'ativo')
on conflict (slug) do nothing;

-- Nota: o vínculo do administrador com o tenant é criado manualmente
-- após o primeiro signup (ver README, seção "Setup manual pós-migration").
