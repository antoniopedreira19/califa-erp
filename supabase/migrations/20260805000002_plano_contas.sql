-- =====================================================================
-- Task 011 — plano de contas (tipos + subtipos)
-- Ver spec: docs/superpowers/specs/2026-08-05-lancamentos-financeiros-design.md
-- =====================================================================

-- 1) Enum
do $$ begin
  create type natureza_padrao_tipo as enum ('entrada', 'saida', 'ambos');
exception when duplicate_object then null;
end $$;

-- 2) Tipos
create table if not exists public.plano_contas_tipos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  codigo            varchar(6) not null,
  nome              varchar(120) not null,
  natureza_padrao   natureza_padrao_tipo not null,
  ordem             integer not null default 0,
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_tipo_codigo_formato check (codigo ~ '^[A-Z]{2,6}$'),
  constraint chk_tipo_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint uniq_tipo_codigo_por_tenant unique (tenant_id, codigo)
);

create index if not exists idx_tipos_tenant on public.plano_contas_tipos(tenant_id);
create index if not exists idx_tipos_ativo on public.plano_contas_tipos(tenant_id, ativo);

drop trigger if exists trg_tipos_updated_at on public.plano_contas_tipos;
create trigger trg_tipos_updated_at
  before update on public.plano_contas_tipos
  for each row execute function public.set_updated_at();

alter table public.plano_contas_tipos enable row level security;

drop policy if exists tipos_select on public.plano_contas_tipos;
create policy tipos_select on public.plano_contas_tipos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists tipos_insert on public.plano_contas_tipos;
create policy tipos_insert on public.plano_contas_tipos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists tipos_update on public.plano_contas_tipos;
create policy tipos_update on public.plano_contas_tipos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.plano_contas_tipos to authenticated;

-- 3) Subtipos
create table if not exists public.plano_contas_subtipos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  tipo_id       uuid not null references public.plano_contas_tipos(id) on delete restrict,
  nome          varchar(160) not null,
  ordem         integer not null default 0,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_subtipo_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint uniq_subtipo_nome_por_tipo unique (tenant_id, tipo_id, nome)
);

create index if not exists idx_subtipos_tenant on public.plano_contas_subtipos(tenant_id);
create index if not exists idx_subtipos_tipo on public.plano_contas_subtipos(tipo_id);
create index if not exists idx_subtipos_ativo on public.plano_contas_subtipos(tenant_id, ativo);

drop trigger if exists trg_subtipos_updated_at on public.plano_contas_subtipos;
create trigger trg_subtipos_updated_at
  before update on public.plano_contas_subtipos
  for each row execute function public.set_updated_at();

alter table public.plano_contas_subtipos enable row level security;

drop policy if exists subtipos_select on public.plano_contas_subtipos;
create policy subtipos_select on public.plano_contas_subtipos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists subtipos_insert on public.plano_contas_subtipos;
create policy subtipos_insert on public.plano_contas_subtipos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists subtipos_update on public.plano_contas_subtipos;
create policy subtipos_update on public.plano_contas_subtipos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.plano_contas_subtipos to authenticated;

-- 4) Seed dos 15 tipos no tenant California (idempotente)
do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id
    from public.tenants
   order by created_at asc
   limit 1;

  if v_tenant_id is null then return; end if;

  insert into public.plano_contas_tipos (tenant_id, codigo, nome, natureza_padrao, ordem)
  values
    (v_tenant_id, 'REC',  'Receita',                'entrada', 10),
    (v_tenant_id, 'CO',   'Custo Operacional',      'saida',   20),
    (v_tenant_id, 'CT',   'Custo Tributário',       'saida',   30),
    (v_tenant_id, 'CF',   'Custo Fixo',             'saida',   40),
    (v_tenant_id, 'DP',   'Despesa com Pessoal',    'saida',   50),
    (v_tenant_id, 'DM',   'Despesa de Marketing',   'saida',   60),
    (v_tenant_id, 'DA',   'Despesa Administrativa', 'saida',   70),
    (v_tenant_id, 'DC',   'Despesa Comercial',      'saida',   80),
    (v_tenant_id, 'DT',   'Despesa Trabalhista',    'saida',   90),
    (v_tenant_id, 'RF',   'Receita Financeira',     'entrada', 100),
    (v_tenant_id, 'DJ',   'Despesa com Juros',      'saida',   110),
    (v_tenant_id, 'EMP',  'Empréstimos',            'ambos',   120),
    (v_tenant_id, 'IMOB', 'Imobilizado',            'saida',   130),
    (v_tenant_id, 'PL',   'Bonificação',            'saida',   140),
    (v_tenant_id, 'DL',   'Distribuição de Lucro',  'saida',   150)
  on conflict (tenant_id, codigo) do nothing;
end$$;
