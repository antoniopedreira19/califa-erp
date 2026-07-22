-- =====================================================================
-- Task 004 — Grupos de itens da versão
--
-- Refina o modelo de itens: "grupo" deixa de ser string livre no item e
-- vira entidade filha da versão, com nome, ordem e cadastro próprio.
-- Layout da planilha padrão (Equipe, Ativação Vending, Sampling, Staff...)
-- é exatamente esse padrão de grupo → itens.
--
-- Escopo:
--   - Nova tabela versoes_orcamento_grupos
--   - itens.grupo_id FK obrigatória (backfill dispensado — 0 itens hoje)
--   - Drop da coluna text `grupo` (não é mais usada)
--   - RLS + GRANTs no novo padrão
-- =====================================================================

-- 1. Tabela versoes_orcamento_grupos
create table if not exists public.versoes_orcamento_grupos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  versao_orcamento_id uuid not null references public.versoes_orcamento(id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grupos_nome_nao_vazio check (length(trim(nome)) > 0)
);

-- Nome único por versão (case-insensitive). Evita "Equipe" e "equipe" coexistindo.
create unique index if not exists uniq_grupo_nome_por_versao
  on public.versoes_orcamento_grupos(tenant_id, versao_orcamento_id, lower(nome));

create index if not exists idx_grupos_tenant on public.versoes_orcamento_grupos(tenant_id);
create index if not exists idx_grupos_versao on public.versoes_orcamento_grupos(versao_orcamento_id);
create index if not exists idx_grupos_ordem on public.versoes_orcamento_grupos(versao_orcamento_id, ordem);

drop trigger if exists trg_grupos_updated_at on public.versoes_orcamento_grupos;
create trigger trg_grupos_updated_at
before update on public.versoes_orcamento_grupos
for each row execute function public.set_updated_at();

-- 2. Ajustes em versoes_orcamento_itens
alter table public.versoes_orcamento_itens
  add column if not exists grupo_id uuid
    references public.versoes_orcamento_grupos(id) on delete restrict;

-- (Backfill não necessário — validado via COUNT: 0 itens na tabela.)

-- Não há itens hoje, então já podemos exigir grupo_id.
alter table public.versoes_orcamento_itens
  alter column grupo_id set not null;

-- Remove a coluna text `grupo` (agora vive em versoes_orcamento_grupos.nome).
alter table public.versoes_orcamento_itens drop column if exists grupo;

create index if not exists idx_itens_grupo on public.versoes_orcamento_itens(grupo_id);

-- 3. RLS grupos
alter table public.versoes_orcamento_grupos enable row level security;

drop policy if exists grupos_select on public.versoes_orcamento_grupos;
create policy grupos_select on public.versoes_orcamento_grupos
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists grupos_insert on public.versoes_orcamento_grupos;
create policy grupos_insert on public.versoes_orcamento_grupos
for insert
to authenticated
with check (public.is_tenant_member(tenant_id));

drop policy if exists grupos_update on public.versoes_orcamento_grupos;
create policy grupos_update on public.versoes_orcamento_grupos
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists grupos_delete on public.versoes_orcamento_grupos;
create policy grupos_delete on public.versoes_orcamento_grupos
for delete
to authenticated
using (public.is_tenant_member(tenant_id));

-- 4. GRANTs
grant select, insert, update, delete on public.versoes_orcamento_grupos to authenticated;
