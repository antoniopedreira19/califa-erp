-- =====================================================================
-- Task 011 — contas_bancarias (auxiliar de lancamentos_financeiros)
-- Ver spec: docs/superpowers/specs/2026-08-05-lancamentos-financeiros-design.md
-- =====================================================================

create table if not exists public.contas_bancarias (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  empresa_id          uuid not null references public.empresas(id) on delete restrict,
  nome                text not null,
  banco               text not null,
  agencia             text,
  numero_conta        text,
  tipo                text not null,
  saldo_inicial       numeric(14,2) not null default 0,
  saldo_inicial_data  date not null,
  ativo               boolean not null default true,
  ordem               integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_conta_nome_nao_vazio check (length(trim(nome)) > 0),
  constraint chk_conta_banco_nao_vazio check (length(trim(banco)) > 0),
  constraint chk_conta_tipo_valido
    check (tipo in ('corrente','poupanca','investimento','caixa')),
  constraint uniq_conta_id_empresa unique (id, empresa_id)
);

create index if not exists idx_contas_bancarias_tenant on public.contas_bancarias(tenant_id);
create index if not exists idx_contas_bancarias_empresa on public.contas_bancarias(empresa_id);
create index if not exists idx_contas_bancarias_ativo on public.contas_bancarias(tenant_id, ativo);

drop trigger if exists trg_contas_bancarias_updated_at on public.contas_bancarias;
create trigger trg_contas_bancarias_updated_at
  before update on public.contas_bancarias
  for each row execute function public.set_updated_at();

alter table public.contas_bancarias enable row level security;

drop policy if exists contas_bancarias_select on public.contas_bancarias;
create policy contas_bancarias_select on public.contas_bancarias
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists contas_bancarias_insert on public.contas_bancarias;
create policy contas_bancarias_insert on public.contas_bancarias
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists contas_bancarias_update on public.contas_bancarias;
create policy contas_bancarias_update on public.contas_bancarias
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.contas_bancarias to authenticated;
