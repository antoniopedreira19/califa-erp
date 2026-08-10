-- =====================================================================
-- Task 012 — contas_avulsas (obrigações pendentes fora de PP)
-- Ver spec: docs/superpowers/specs/2026-08-06-contas-avulsas-design.md
-- =====================================================================

-- 1) Enum de status
do $$ begin
  create type conta_avulsa_status as enum ('pendente', 'baixada');
exception when duplicate_object then null;
end $$;

-- 2) Tabela principal
create table if not exists public.contas_avulsas (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  empresa_id                  uuid not null references public.empresas(id) on delete restrict,
  descricao                   text not null,
  valor                       numeric(14,2) not null,
  natureza                    natureza_lancamento not null,
  data_prevista_pagamento     date,
  status                      conta_avulsa_status not null default 'pendente',
  fornecedor_id               uuid references public.fornecedores(id) on delete restrict,
  cliente_id                  uuid references public.clientes(id) on delete restrict,
  job_id                      uuid references public.jobs(id) on delete restrict,
  plano_conta_tipo_id         uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id      uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  pago_em                     date,
  pago_por                    uuid references public.profiles(id),
  conta_bancaria_baixa_id     uuid references public.contas_bancarias(id) on delete restrict,
  criado_por                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint chk_avulsa_valor_positivo check (valor > 0),
  constraint chk_avulsa_descricao_nao_vazia check (length(trim(descricao)) >= 3),
  constraint chk_avulsa_baixa_consistente check (
    (status = 'baixada'
      and pago_em is not null
      and pago_por is not null
      and conta_bancaria_baixa_id is not null)
    or
    (status = 'pendente'
      and pago_em is null
      and pago_por is null
      and conta_bancaria_baixa_id is null)
  ),
  constraint chk_avulsa_contraparte_unica check (
    not (fornecedor_id is not null and cliente_id is not null)
  )
);

create index if not exists idx_avulsas_tenant on public.contas_avulsas(tenant_id);
create index if not exists idx_avulsas_empresa on public.contas_avulsas(empresa_id);
create index if not exists idx_avulsas_status on public.contas_avulsas(tenant_id, status);
create index if not exists idx_avulsas_data_prevista on public.contas_avulsas(tenant_id, data_prevista_pagamento);
create index if not exists idx_avulsas_fornecedor on public.contas_avulsas(fornecedor_id);
create index if not exists idx_avulsas_cliente on public.contas_avulsas(cliente_id);
create index if not exists idx_avulsas_job on public.contas_avulsas(job_id);

drop trigger if exists trg_avulsas_updated_at on public.contas_avulsas;
create trigger trg_avulsas_updated_at
  before update on public.contas_avulsas
  for each row execute function public.set_updated_at();

alter table public.contas_avulsas enable row level security;

drop policy if exists avulsas_select on public.contas_avulsas;
create policy avulsas_select on public.contas_avulsas
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsas_insert on public.contas_avulsas;
create policy avulsas_insert on public.contas_avulsas
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsas_update on public.contas_avulsas;
create policy avulsas_update on public.contas_avulsas
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsas_delete on public.contas_avulsas;
create policy avulsas_delete on public.contas_avulsas
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas to authenticated;

-- 3) Tabela de anexos
create table if not exists public.contas_avulsas_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id       uuid not null references public.contas_avulsas(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint chk_anexo_avulsa_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index if not exists idx_avulsa_anexos_conta on public.contas_avulsas_anexos(conta_avulsa_id);
create index if not exists idx_avulsa_anexos_tenant on public.contas_avulsas_anexos(tenant_id);

alter table public.contas_avulsas_anexos enable row level security;

drop policy if exists avulsa_anexos_select on public.contas_avulsas_anexos;
create policy avulsa_anexos_select on public.contas_avulsas_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_anexos_insert on public.contas_avulsas_anexos;
create policy avulsa_anexos_insert on public.contas_avulsas_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_anexos_delete on public.contas_avulsas_anexos;
create policy avulsa_anexos_delete on public.contas_avulsas_anexos
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, delete on public.contas_avulsas_anexos to authenticated;

-- 4) Tabela de histórico (imutável)
create table if not exists public.contas_avulsas_historico (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id   uuid not null references public.contas_avulsas(id) on delete cascade,
  campo_alterado    varchar(60) not null,
  valor_anterior    text,
  valor_novo        text,
  alterado_por      uuid not null references public.profiles(id),
  alterado_em       timestamptz not null default now()
);

create index if not exists idx_avulsa_hist_conta on public.contas_avulsas_historico(conta_avulsa_id, alterado_em desc);
create index if not exists idx_avulsa_hist_tenant on public.contas_avulsas_historico(tenant_id);

alter table public.contas_avulsas_historico enable row level security;

drop policy if exists avulsa_hist_select on public.contas_avulsas_historico;
create policy avulsa_hist_select on public.contas_avulsas_historico
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_hist_insert on public.contas_avulsas_historico;
create policy avulsa_hist_insert on public.contas_avulsas_historico
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

grant select, insert on public.contas_avulsas_historico to authenticated;

-- 5) Bucket privado + storage policies
insert into storage.buckets (id, name, public)
values ('contas-avulsas', 'contas-avulsas', false)
on conflict (id) do nothing;

drop policy if exists avulsas_storage_select on storage.objects;
create policy avulsas_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contas-avulsas'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists avulsas_storage_insert on storage.objects;
create policy avulsas_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contas-avulsas'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists avulsas_storage_delete on storage.objects;
create policy avulsas_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contas-avulsas'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );
