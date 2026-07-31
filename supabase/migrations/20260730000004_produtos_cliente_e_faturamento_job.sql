-- =====================================================================
-- Produtos do cliente + data prevista de faturamento no job
--
-- Origem: handoff "Abertura de Job.dc.html". O modal de abertura de job
-- pede Produto vindo do cadastro do cliente e Data prevista para
-- faturamento, e nenhum dos dois existia.
--
-- `cliente_produtos` segue o padrão de `regionais`/`cidades` (RLS por
-- is_tenant_member, grants para authenticated, soft-delete via `ativo`,
-- sem DELETE), com uma diferença: o escopo é o CLIENTE, não o tenant.
-- Cada cliente tem sua própria lista, gerenciada dentro da tela dele.
--
-- O código (PRD-01, PRD-02…) é sequencial POR CLIENTE e gerado na
-- action, não no banco: a numeração é cosmética e um trigger de
-- sequência por cliente custaria mais do que entrega. O unique index
-- (cliente_id, codigo) captura colisão de corrida.
-- =====================================================================

-- 1) cliente_produtos ---------------------------------------------------
create table if not exists public.cliente_produtos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  cliente_id  uuid not null references public.clientes(id) on delete restrict,
  nome        text not null,
  codigo      text not null,
  ativo       boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cliente_produtos_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint cliente_produtos_codigo_nao_vazio check (length(trim(codigo)) > 0)
);

-- Nome e código são únicos dentro do cliente, não do tenant: dois
-- clientes podem ter "Ativação de marca" e ambos começam em PRD-01.
create unique index if not exists uniq_cliente_produto_nome
  on public.cliente_produtos(cliente_id, lower(nome));

create unique index if not exists uniq_cliente_produto_codigo
  on public.cliente_produtos(cliente_id, codigo);

create index if not exists idx_cliente_produtos_tenant
  on public.cliente_produtos(tenant_id);
create index if not exists idx_cliente_produtos_cliente
  on public.cliente_produtos(cliente_id);
-- Dropdown do modal de job filtra por cliente + ativo.
create index if not exists idx_cliente_produtos_ativo
  on public.cliente_produtos(cliente_id, ativo);

drop trigger if exists trg_cliente_produtos_updated_at on public.cliente_produtos;
create trigger trg_cliente_produtos_updated_at
  before update on public.cliente_produtos
  for each row execute function public.set_updated_at();

alter table public.cliente_produtos enable row level security;

drop policy if exists cliente_produtos_select on public.cliente_produtos;
create policy cliente_produtos_select on public.cliente_produtos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists cliente_produtos_insert on public.cliente_produtos;
create policy cliente_produtos_insert on public.cliente_produtos
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists cliente_produtos_update on public.cliente_produtos;
create policy cliente_produtos_update on public.cliente_produtos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE (soft-delete via ativo=false), igual a regionais e cidades.
grant select, insert, update on public.cliente_produtos to authenticated;

-- 2) jobs.data_prevista_faturamento -------------------------------------
-- Nullable de propósito: já existem jobs gravados e um NOT NULL exigiria
-- backfill. A obrigatoriedade vive no Zod do modal de abertura.
alter table public.jobs
  add column if not exists data_prevista_faturamento date;

comment on column public.jobs.data_prevista_faturamento is
  'Data prevista para o faturamento do job. Informada na abertura.';
