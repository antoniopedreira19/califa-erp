-- =====================================================================
-- Títulos a receber (parcelas de uma NF). 1 faturamento → N títulos.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) Enum
do $$ begin
  create type titulo_receber_status as enum ('em_aberto', 'pago', 'cancelado');
exception when duplicate_object then null;
end $$;

-- 2) Tabela
create table if not exists public.titulos_receber (
  id                              uuid primary key default gen_random_uuid(),
  tenant_id                       uuid not null references public.tenants(id) on delete restrict,
  empresa_id                      uuid not null references public.empresas(id) on delete restrict,
  faturamento_id                  uuid not null references public.faturamentos(id) on delete restrict,
  numero_parcela                  smallint not null,
  valor                           numeric(14, 2) not null,
  data_vencimento                 date not null,
  status                          titulo_receber_status not null default 'em_aberto',
  pago_em                         date,
  pago_por                        uuid references public.profiles(id),
  conta_bancaria_recebimento_id   uuid references public.contas_bancarias(id) on delete restrict,
  lancamento_id                   uuid, -- FK adicionada em migration posterior (dependência circular resolvida na Task 3)
  cancelado_em                    timestamptz,
  cancelado_por                   uuid references public.profiles(id),
  created_at                      timestamptz not null default now(),

  constraint chk_titulo_pago_consistente check (
    (status = 'pago'
      and pago_em is not null
      and pago_por is not null
      and conta_bancaria_recebimento_id is not null
      and lancamento_id is not null)
    or
    (status <> 'pago'
      and pago_em is null
      and pago_por is null
      and conta_bancaria_recebimento_id is null
      and lancamento_id is null)
  ),
  constraint chk_titulo_valor_positivo check (valor > 0),
  constraint chk_titulo_parcela_positiva check (numero_parcela > 0)
);

-- 3) Índices
create index if not exists idx_titulos_tenant on public.titulos_receber(tenant_id);
create index if not exists idx_titulos_faturamento on public.titulos_receber(faturamento_id);
create index if not exists idx_titulos_status on public.titulos_receber(tenant_id, status);
create index if not exists idx_titulos_vencimento_em_aberto
  on public.titulos_receber(tenant_id, data_vencimento)
  where status = 'em_aberto';
create index if not exists idx_titulos_empresa on public.titulos_receber(empresa_id);

-- 4) RLS + GRANT
alter table public.titulos_receber enable row level security;

drop policy if exists titulos_select on public.titulos_receber;
create policy titulos_select on public.titulos_receber
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists titulos_insert on public.titulos_receber;
create policy titulos_insert on public.titulos_receber
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists titulos_update on public.titulos_receber;
create policy titulos_update on public.titulos_receber
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.titulos_receber to authenticated;
