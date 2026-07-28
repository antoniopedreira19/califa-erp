-- =====================================================================
-- Categorias de domínio (projeto e orçamento)
--
-- Vocabulário independente do de itens (que vive em `categorias`).
-- Aqui classificamos o próprio projeto ("Ativação", "Campanha"...) e
-- o próprio orçamento ("Mídia", "Influencer"...).
--
-- Design: tabela única com coluna `escopo` (enum) em vez de duas
-- tabelas paralelas — 1 CRUD e 1 admin com filtro. FK dos consumidores
-- (projetos.categoria_id, orcamentos.categoria_id) aponta pra esta
-- tabela; server actions + UI filtram por escopo. O banco não impede
-- referência cross-escopo — proteção fica na aplicação.
-- =====================================================================

-- 1) enum de escopo -----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'categoria_dominio_escopo') then
    create type public.categoria_dominio_escopo as enum ('projeto', 'orcamento');
  end if;
end$$;

-- 2) tabela categorias_dominio -----------------------------------------
create table if not exists public.categorias_dominio (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  escopo      public.categoria_dominio_escopo not null,
  nome        text not null,
  ativo       boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categorias_dominio_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index if not exists uniq_categoria_dominio_por_escopo_tenant
  on public.categorias_dominio(tenant_id, escopo, lower(nome));

create index if not exists idx_categorias_dominio_tenant on public.categorias_dominio(tenant_id);
create index if not exists idx_categorias_dominio_ativo  on public.categorias_dominio(tenant_id, escopo, ativo);

drop trigger if exists trg_categorias_dominio_updated_at on public.categorias_dominio;
create trigger trg_categorias_dominio_updated_at
  before update on public.categorias_dominio
  for each row execute function public.set_updated_at();

alter table public.categorias_dominio enable row level security;

drop policy if exists categorias_dominio_select on public.categorias_dominio;
create policy categorias_dominio_select on public.categorias_dominio
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists categorias_dominio_insert on public.categorias_dominio;
create policy categorias_dominio_insert on public.categorias_dominio
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists categorias_dominio_update on public.categorias_dominio;
create policy categorias_dominio_update on public.categorias_dominio
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE (soft-delete via ativo=false)

grant select, insert, update on public.categorias_dominio to authenticated;

-- 3) FKs em projetos e orçamentos --------------------------------------
alter table public.projetos
  add column if not exists categoria_id uuid references public.categorias_dominio(id) on delete restrict;

-- orcamentos: apaga o campo antigo `tipo` (texto livre) e adiciona categoria_id
alter table public.orcamentos
  drop column if exists tipo;

alter table public.orcamentos
  add column if not exists categoria_id uuid references public.categorias_dominio(id) on delete restrict;

create index if not exists idx_projetos_categoria   on public.projetos(categoria_id);
create index if not exists idx_orcamentos_categoria on public.orcamentos(categoria_id);

-- 4) Seed das categorias pré-definidas do tenant Agência California ----
insert into public.categorias_dominio (tenant_id, escopo, nome)
select t.id, 'projeto', v.nome
  from public.tenants t
 cross join (values
   ('Fee'),
   ('Projeto proprietário'),
   ('Ativação'),
   ('Evento'),
   ('Campanha')
 ) as v(nome)
 where t.slug = 'agencia-california'
   and not exists (
     select 1 from public.categorias_dominio cd
      where cd.tenant_id = t.id and cd.escopo = 'projeto' and lower(cd.nome) = lower(v.nome)
   );

insert into public.categorias_dominio (tenant_id, escopo, nome)
select t.id, 'orcamento', v.nome
  from public.tenants t
 cross join (values
   ('Always On'),
   ('Mídia'),
   ('Evento'),
   ('Influencer'),
   ('Extra')
 ) as v(nome)
 where t.slug = 'agencia-california'
   and not exists (
     select 1 from public.categorias_dominio cd
      where cd.tenant_id = t.id and cd.escopo = 'orcamento' and lower(cd.nome) = lower(v.nome)
   );
