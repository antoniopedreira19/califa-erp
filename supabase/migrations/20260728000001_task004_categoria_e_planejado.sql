-- =====================================================================
-- Task 004 fase G — Categoria por versão + visão PLANEJADO no item
-- Ver spec: docs/superpowers/specs/2026-07-23-planejado-e-categoria-design.md
-- =====================================================================

-- 1. Tabela versoes_orcamento_categorias (mesmo padrão de _grupos)
create table if not exists public.versoes_orcamento_categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  versao_orcamento_id uuid not null references public.versoes_orcamento(id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categorias_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index if not exists uniq_categoria_nome_por_versao
  on public.versoes_orcamento_categorias(tenant_id, versao_orcamento_id, lower(nome));

create index if not exists idx_categorias_tenant on public.versoes_orcamento_categorias(tenant_id);
create index if not exists idx_categorias_versao on public.versoes_orcamento_categorias(versao_orcamento_id);

drop trigger if exists trg_categorias_updated_at on public.versoes_orcamento_categorias;
create trigger trg_categorias_updated_at
before update on public.versoes_orcamento_categorias
for each row execute function public.set_updated_at();

-- 2. RLS categorias — mesmo padrão dos grupos
alter table public.versoes_orcamento_categorias enable row level security;

drop policy if exists categorias_select on public.versoes_orcamento_categorias;
create policy categorias_select on public.versoes_orcamento_categorias
for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists categorias_insert on public.versoes_orcamento_categorias;
create policy categorias_insert on public.versoes_orcamento_categorias
for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists categorias_update on public.versoes_orcamento_categorias;
create policy categorias_update on public.versoes_orcamento_categorias
for update to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists categorias_delete on public.versoes_orcamento_categorias;
create policy categorias_delete on public.versoes_orcamento_categorias
for delete to authenticated using (public.is_tenant_member(tenant_id));

-- 3. GRANTs authenticated (service_role coberto por ALTER DEFAULT PRIVILEGES)
grant select, insert, update, delete on public.versoes_orcamento_categorias to authenticated;

-- 4. Colunas planejadas + categoria_id em versoes_orcamento_itens
alter table public.versoes_orcamento_itens
  add column if not exists categoria_id uuid
    references public.versoes_orcamento_categorias(id) on delete set null;

alter table public.versoes_orcamento_itens
  add column if not exists valor_unitario_planejado numeric(14, 2) not null default 0;

alter table public.versoes_orcamento_itens
  add column if not exists quantidade_planejada numeric(12, 3) not null default 0;

alter table public.versoes_orcamento_itens
  add column if not exists dias_meses_planejado numeric(12, 3) not null default 0;

alter table public.versoes_orcamento_itens
  add column if not exists total_planejado numeric(18, 2) generated always as (
    coalesce(valor_unitario_planejado, 0)
    * coalesce(quantidade_planejada, 0)
    * coalesce(dias_meses_planejado, 0)
  ) stored;

create index if not exists idx_itens_categoria on public.versoes_orcamento_itens(categoria_id);

-- 5. Constraints do planejado (permitem 0 — "não planejado ainda")
alter table public.versoes_orcamento_itens
  drop constraint if exists itens_planejado_valor_nao_negativo;
alter table public.versoes_orcamento_itens
  add constraint itens_planejado_valor_nao_negativo check (valor_unitario_planejado >= 0);

alter table public.versoes_orcamento_itens
  drop constraint if exists itens_planejado_qtd_nao_negativa;
alter table public.versoes_orcamento_itens
  add constraint itens_planejado_qtd_nao_negativa check (quantidade_planejada >= 0);

alter table public.versoes_orcamento_itens
  drop constraint if exists itens_planejado_dm_nao_negativo;
alter table public.versoes_orcamento_itens
  add constraint itens_planejado_dm_nao_negativo check (dias_meses_planejado >= 0);
