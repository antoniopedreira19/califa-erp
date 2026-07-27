-- Task: Catálogo global de categorias no tenant
-- Substitui versoes_orcamento_categorias (por versão) por categorias (por tenant)
-- Spec: docs/superpowers/specs/2026-07-27-catalogo-global-categorias-design.md

-- 1) Wipe: zera classificação de todos os itens antes de trocar FK.
-- Volume atual é mínimo (Fase G recém-fechada). GP recadastra via drawer.
update public.versoes_orcamento_itens set categoria_id = null;

-- 2) Remove a FK antiga (que apontava pra versoes_orcamento_categorias).
alter table public.versoes_orcamento_itens
  drop constraint if exists versoes_orcamento_itens_categoria_id_fkey;

-- 3) Descarta a tabela antiga (cascade limpa policies/triggers/índices).
drop table if exists public.versoes_orcamento_categorias cascade;

-- 4) Cria a nova tabela categorias (escopo tenant).
create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint categorias_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index uniq_categoria_nome_por_tenant
  on public.categorias(tenant_id, lower(nome));

create index idx_categorias_tenant on public.categorias(tenant_id);
create index idx_categorias_ativo on public.categorias(tenant_id, ativo);

create trigger trg_categorias_updated_at
  before update on public.categorias
  for each row execute function public.set_updated_at();

-- 5) Adiciona a FK nova (aponta pra categorias global) em versoes_orcamento_itens.
alter table public.versoes_orcamento_itens
  add constraint versoes_orcamento_itens_categoria_id_fkey
  foreign key (categoria_id) references public.categorias(id) on delete restrict;

-- 6) RLS: todos os membros do tenant fazem select/insert/update.
--    DELETE não tem policy (soft-delete only via ativo=false).
--    Gate "só admin inativa" fica no server action, não em RLS.
alter table public.categorias enable row level security;

create policy categorias_select on public.categorias
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy categorias_insert on public.categorias
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy categorias_update on public.categorias
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- 7) GRANTs (RLS não substitui GRANT).
grant select, insert, update on public.categorias to authenticated;
