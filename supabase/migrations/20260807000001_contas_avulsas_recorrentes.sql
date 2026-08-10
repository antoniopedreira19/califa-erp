-- =====================================================================
-- Task 013 — contas_avulsas_recorrentes (template + FK em avulsa)
-- Ver spec: docs/superpowers/specs/2026-08-07-contas-avulsas-recorrentes-design.md
-- =====================================================================

-- 1) Enum de frequência
do $$ begin
  create type frequencia_recorrencia as enum ('quinzenal', 'mensal', 'anual');
exception when duplicate_object then null;
end $$;

-- 2) Tabela principal (template)
create table if not exists public.contas_avulsas_recorrentes (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  empresa_id                  uuid not null references public.empresas(id) on delete restrict,
  descricao                   text not null,
  valor                       numeric(14,2) not null,
  fornecedor_id               uuid references public.fornecedores(id) on delete restrict,
  cliente_id                  uuid references public.clientes(id) on delete restrict,
  job_id                      uuid references public.jobs(id) on delete restrict,
  plano_conta_tipo_id         uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id      uuid not null references public.plano_contas_subtipos(id) on delete restrict,

  frequencia                  frequencia_recorrencia not null,
  dia_do_mes                  smallint,
  dia_quinzena_1              smallint,
  dia_quinzena_2              smallint,
  dia_do_ano_dia              smallint,
  dia_do_ano_mes              smallint,

  proxima_data                date not null,
  data_fim                    date,

  ativo                       boolean not null default true,
  criado_por                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint chk_rec_valor_positivo check (valor > 0),
  constraint chk_rec_descricao_nao_vazia check (length(trim(descricao)) >= 3),

  constraint chk_rec_frequencia_mensal check (
    frequencia <> 'mensal' or (
      dia_do_mes is not null and dia_do_mes between 1 and 31
      and dia_quinzena_1 is null and dia_quinzena_2 is null
      and dia_do_ano_dia is null and dia_do_ano_mes is null
    )
  ),
  constraint chk_rec_frequencia_quinzenal check (
    frequencia <> 'quinzenal' or (
      dia_quinzena_1 is not null and dia_quinzena_2 is not null
      and dia_quinzena_1 between 1 and 31
      and dia_quinzena_2 between 1 and 31
      and dia_quinzena_1 < dia_quinzena_2
      and dia_do_mes is null
      and dia_do_ano_dia is null and dia_do_ano_mes is null
    )
  ),
  constraint chk_rec_frequencia_anual check (
    frequencia <> 'anual' or (
      dia_do_ano_dia is not null and dia_do_ano_dia between 1 and 31
      and dia_do_ano_mes is not null and dia_do_ano_mes between 1 and 12
      and dia_do_mes is null
      and dia_quinzena_1 is null and dia_quinzena_2 is null
    )
  ),

  constraint chk_rec_data_fim_ordem check (
    data_fim is null or data_fim >= proxima_data
  )
);

create index if not exists idx_rec_tenant on public.contas_avulsas_recorrentes(tenant_id);
create index if not exists idx_rec_empresa on public.contas_avulsas_recorrentes(empresa_id);
create index if not exists idx_rec_ativos_prox_data
  on public.contas_avulsas_recorrentes(tenant_id, ativo, proxima_data)
  where ativo = true;
create index if not exists idx_rec_fornecedor on public.contas_avulsas_recorrentes(fornecedor_id);

drop trigger if exists trg_rec_updated_at on public.contas_avulsas_recorrentes;
create trigger trg_rec_updated_at
  before update on public.contas_avulsas_recorrentes
  for each row execute function public.set_updated_at();

alter table public.contas_avulsas_recorrentes enable row level security;

drop policy if exists rec_select on public.contas_avulsas_recorrentes;
create policy rec_select on public.contas_avulsas_recorrentes
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists rec_insert on public.contas_avulsas_recorrentes;
create policy rec_insert on public.contas_avulsas_recorrentes
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_update on public.contas_avulsas_recorrentes;
create policy rec_update on public.contas_avulsas_recorrentes
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_delete on public.contas_avulsas_recorrentes;
create policy rec_delete on public.contas_avulsas_recorrentes
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_recorrentes to authenticated;

-- 3) FK opcional em contas_avulsas
alter table public.contas_avulsas
  add column if not exists recorrente_id uuid
    references public.contas_avulsas_recorrentes(id) on delete set null;

create index if not exists idx_avulsas_recorrente
  on public.contas_avulsas(recorrente_id)
  where recorrente_id is not null;
