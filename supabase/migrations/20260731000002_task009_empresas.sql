-- =====================================================================
-- Task 009 — Empresas (pessoas jurídicas do grupo California)
--
-- Introduz `empresas` (tenant-wide, FK para `regionais`) e liga a
-- `projetos`, `orcamentos` e `jobs` via nova coluna `empresa_id`.
--
-- Decisões (spec 2026-07-31-empresas-multi-cnpj-design.md):
--   - Tenant permanece como "grupo California"; empresa = PJ dentro do
--     grupo. Um tenant pode ter N empresas.
--   - Projeto é a fonte da verdade: orçamento e job herdam `empresa_id`
--     via trigger BEFORE INSERT/UPDATE. UI/API nunca passa o valor
--     nessas duas tabelas. Cascata em UPDATE de projeto reescreve
--     filhos.
--   - `principal boolean` com índice único parcial garante exatamente
--     1 empresa principal por tenant.
--   - Cliente/fornecedor/categoria continuam do tenant, sem `empresa_id`.
--   - Formatos armazenados: CNPJ 14 dígitos, CEP 8 dígitos, telefone
--     10-11 dígitos, UF 2 letras maiúsculas.
--   - RLS: SELECT para todo membro do tenant; INSERT/UPDATE só admin.
--     Sem DELETE (soft-delete via ativo=false).
-- =====================================================================

-- 1) Tabela empresas ----------------------------------------------------
create table if not exists public.empresas (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete restrict,
  regional_id          uuid not null references public.regionais(id) on delete restrict,
  razao_social         text not null,
  nome_fantasia        text,
  cnpj                 text not null,
  inscricao_estadual   text,
  inscricao_municipal  text,
  logradouro           text not null,
  numero               text,
  complemento          text,
  bairro               text,
  cidade               text not null,
  uf                   char(2) not null,
  cep                  text not null,
  telefone             text,
  email                text,
  local_pagamento      text,
  instrucoes_nf        text,
  principal            boolean not null default false,
  ativo                boolean not null default true,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_empresas_razao_social_nao_vazio check (length(trim(razao_social)) > 0),
  constraint chk_empresas_cnpj_formato check (cnpj ~ '^[0-9]{14}$'),
  constraint chk_empresas_cep_formato check (cep ~ '^[0-9]{8}$'),
  constraint chk_empresas_telefone_formato check (telefone is null or telefone ~ '^[0-9]{10,11}$'),
  constraint chk_empresas_uf_formato check (uf ~ '^[A-Z]{2}$')
);

-- 2) Índices ------------------------------------------------------------
create unique index if not exists uniq_empresas_cnpj_por_tenant
  on public.empresas(tenant_id, cnpj);

create unique index if not exists uniq_empresas_principal_por_tenant
  on public.empresas(tenant_id)
  where principal = true;

create index if not exists idx_empresas_tenant   on public.empresas(tenant_id);
create index if not exists idx_empresas_regional on public.empresas(regional_id);
create index if not exists idx_empresas_ativo    on public.empresas(tenant_id, ativo);

-- 3) Trigger updated_at -------------------------------------------------
drop trigger if exists trg_empresas_updated_at on public.empresas;
create trigger trg_empresas_updated_at
  before update on public.empresas
  for each row execute function public.set_updated_at();

-- 4) RLS + policies -----------------------------------------------------
alter table public.empresas enable row level security;

drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists empresas_insert on public.empresas;
create policy empresas_insert on public.empresas
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Sem policy DELETE — soft-delete via ativo=false.

grant select, insert, update on public.empresas to authenticated;

-- 5) Seed: regional NE + California Salvador ---------------------------
-- Executa apenas se houver tenant California; MVP tem exatamente um.
do $$
declare
  v_tenant_id  uuid;
  v_regional_id uuid;
begin
  select id into v_tenant_id
    from public.tenants
   order by created_at asc
   limit 1;

  if v_tenant_id is null then
    -- Banco novo sem tenant: nada a fazer.
    return;
  end if;

  -- Regional NE (se ainda não existir para este tenant)
  select id into v_regional_id
    from public.regionais
   where tenant_id = v_tenant_id
     and lower(nome) = 'ne'
   limit 1;

  if v_regional_id is null then
    insert into public.regionais (tenant_id, nome, ativo)
    values (v_tenant_id, 'NE', true)
    returning id into v_regional_id;
  end if;

  -- Empresa California Salvador (se ainda não houver empresa neste tenant)
  if not exists (select 1 from public.empresas where tenant_id = v_tenant_id) then
    insert into public.empresas (
      tenant_id, regional_id,
      razao_social, nome_fantasia,
      cnpj, inscricao_estadual, inscricao_municipal,
      logradouro, numero, complemento, bairro, cidade, uf, cep,
      telefone, email,
      local_pagamento, instrucoes_nf,
      principal, ativo
    ) values (
      v_tenant_id, v_regional_id,
      'CALIFÓRNIA FILMES E PUBLICIDADE LTDA', 'California',
      '19437976000154', 'ISENTO', '479604001-42',
      'AV. DA FRANÇA', '393', 'SETOR 2', 'Comércio', 'Salvador', 'BA', '40010000',
      '71991742040', null,
      null, null,
      true, true
    );
  end if;
end$$;

-- 6) empresa_id em projetos / orcamentos / jobs ------------------------

-- 6a) projetos
alter table public.projetos
  add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;

update public.projetos p
   set empresa_id = e.id
  from public.empresas e
 where p.empresa_id is null
   and e.tenant_id = p.tenant_id
   and e.principal = true;

-- Guarda-corpo: qualquer projeto sem empresa_id significa que não achamos
-- empresa principal para o tenant dele. Aborta com lista dos ids.
do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.projetos where empresa_id is null;
  if v_ids is not null then
    raise exception
      'Backfill de projetos.empresa_id incompleto: %',
      v_ids;
  end if;
end$$;

alter table public.projetos alter column empresa_id set not null;
create index if not exists idx_projetos_empresa on public.projetos(empresa_id);

-- 6b) orcamentos
alter table public.orcamentos
  add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;

update public.orcamentos o
   set empresa_id = p.empresa_id
  from public.projetos p
 where o.empresa_id is null
   and p.id = o.projeto_id;

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.orcamentos where empresa_id is null;
  if v_ids is not null then
    raise exception
      'Backfill de orcamentos.empresa_id incompleto: %',
      v_ids;
  end if;
end$$;

alter table public.orcamentos alter column empresa_id set not null;
create index if not exists idx_orcamentos_empresa on public.orcamentos(empresa_id);

-- 6c) jobs
alter table public.jobs
  add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;

update public.jobs j
   set empresa_id = p.empresa_id
  from public.projetos p
 where j.empresa_id is null
   and p.id = j.projeto_id;

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.jobs where empresa_id is null;
  if v_ids is not null then
    raise exception
      'Backfill de jobs.empresa_id incompleto: %',
      v_ids;
  end if;
end$$;

alter table public.jobs alter column empresa_id set not null;
create index if not exists idx_jobs_empresa on public.jobs(empresa_id);

-- 7) Trigger de propagação: orcamento/job herdam empresa do projeto ---
create or replace function public.enforce_empresa_from_projeto()
returns trigger
language plpgsql
as $$
declare
  v_empresa_id uuid;
begin
  select p.empresa_id into v_empresa_id
    from public.projetos p
   where p.id = NEW.projeto_id;

  if v_empresa_id is null then
    raise exception 'projeto % não possui empresa_id', NEW.projeto_id;
  end if;

  NEW.empresa_id := v_empresa_id;
  return NEW;
end$$;

drop trigger if exists trg_orcamentos_empresa_do_projeto on public.orcamentos;
create trigger trg_orcamentos_empresa_do_projeto
  before insert or update on public.orcamentos
  for each row execute function public.enforce_empresa_from_projeto();

drop trigger if exists trg_jobs_empresa_do_projeto on public.jobs;
create trigger trg_jobs_empresa_do_projeto
  before insert or update on public.jobs
  for each row execute function public.enforce_empresa_from_projeto();

-- 8) Trigger de cascata: mudar empresa do projeto propaga p/ filhos ---
create or replace function public.cascade_empresa_para_filhos()
returns trigger
language plpgsql
as $$
begin
  if NEW.empresa_id is distinct from OLD.empresa_id then
    update public.orcamentos
       set empresa_id = NEW.empresa_id
     where projeto_id = NEW.id
       and empresa_id is distinct from NEW.empresa_id;

    update public.jobs
       set empresa_id = NEW.empresa_id
     where projeto_id = NEW.id
       and empresa_id is distinct from NEW.empresa_id;
  end if;
  return NEW;
end$$;

drop trigger if exists trg_projetos_cascade_empresa on public.projetos;
create trigger trg_projetos_cascade_empresa
  after update on public.projetos
  for each row execute function public.cascade_empresa_para_filhos();
