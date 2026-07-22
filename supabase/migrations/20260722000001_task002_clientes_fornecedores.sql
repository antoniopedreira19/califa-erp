-- =====================================================================
-- Task 002 — Clientes e Fornecedores
--
-- Decisões:
--   - Cliente é sempre pessoa jurídica (nome_fantasia + razao_social).
--     CNPJ é opcional no cadastro (regra do MVP).
--   - Fornecedor pode ser PF ou PJ (freelas contratados como PF entram aqui).
--     CPF/CNPJ opcional; validação de dígito no app.
--   - Exclusão física NÃO existe — usar status='inativo'. Nem RLS nem
--     GRANT permitem DELETE nesta migration.
--   - Duplicidade evidente por documento bloqueada por unique index parcial
--     (só aplica quando documento está preenchido).
--   - Auditoria via chamada explícita da RPC log_audit_event nas Server
--     Actions, não em trigger (para não poluir com metadata técnica).
--
-- LIÇÃO da Task 001: GRANTs de authenticated nesta migration, no fim.
--   RLS sozinho não basta; precisa GRANT SELECT/INSERT/UPDATE.
-- =====================================================================

-- 1. Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_pessoa') then
    create type public.tipo_pessoa as enum ('fisica', 'juridica');
  end if;

  if not exists (select 1 from pg_type where typname = 'cadastro_status') then
    create type public.cadastro_status as enum ('ativo', 'inativo');
  end if;
end$$;

-- 2. Tabela clientes (sempre PJ)
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome_fantasia text not null,
  razao_social text,
  cnpj text,
  email text,
  telefone text,
  observacoes text,
  status public.cadastro_status not null default 'ativo',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clientes_cnpj_only_digits check (cnpj is null or cnpj ~ '^[0-9]{14}$')
);

create index if not exists idx_clientes_tenant on public.clientes(tenant_id);
create index if not exists idx_clientes_status on public.clientes(status);
create index if not exists idx_clientes_nome_fantasia on public.clientes(tenant_id, nome_fantasia);
-- Duplicidade evidente por CNPJ dentro do tenant.
create unique index if not exists uniq_clientes_cnpj_por_tenant
  on public.clientes(tenant_id, cnpj)
  where cnpj is not null;

drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at
before update on public.clientes
for each row execute function public.set_updated_at();

-- 3. Tabela fornecedores (PF ou PJ)
create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  tipo_pessoa public.tipo_pessoa not null default 'juridica',
  nome text not null,
  razao_social text,
  cpf_cnpj text,
  email text,
  telefone text,
  observacoes text,
  status public.cadastro_status not null default 'ativo',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fornecedores_documento_formato check (
    cpf_cnpj is null
    or (tipo_pessoa = 'fisica'   and cpf_cnpj ~ '^[0-9]{11}$')
    or (tipo_pessoa = 'juridica' and cpf_cnpj ~ '^[0-9]{14}$')
  )
);

create index if not exists idx_fornecedores_tenant on public.fornecedores(tenant_id);
create index if not exists idx_fornecedores_status on public.fornecedores(status);
create index if not exists idx_fornecedores_nome on public.fornecedores(tenant_id, nome);
create unique index if not exists uniq_fornecedores_documento_por_tenant
  on public.fornecedores(tenant_id, cpf_cnpj)
  where cpf_cnpj is not null;

drop trigger if exists trg_fornecedores_updated_at on public.fornecedores;
create trigger trg_fornecedores_updated_at
before update on public.fornecedores
for each row execute function public.set_updated_at();

-- 4. RLS clientes
alter table public.clientes enable row level security;

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

-- Sem policy de delete: exclusão física proibida.

-- 5. RLS fornecedores
alter table public.fornecedores enable row level security;

drop policy if exists fornecedores_select on public.fornecedores;
create policy fornecedores_select on public.fornecedores
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists fornecedores_insert on public.fornecedores;
create policy fornecedores_insert on public.fornecedores
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists fornecedores_update on public.fornecedores;
create policy fornecedores_update on public.fornecedores
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

-- 6. GRANTs para authenticated (LIÇÃO Task 001)
grant select, insert, update on public.clientes to authenticated;
grant select, insert, update on public.fornecedores to authenticated;
