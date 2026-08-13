-- =====================================================================
-- Faturamentos (NF emitida). Uma linha por NF.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) Enums
do $$ begin
  create type faturamento_origem as enum ('job', 'bv', 'avulso');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type faturamento_status as enum ('emitido', 'cancelado');
exception when duplicate_object then null;
end $$;

-- 2) Tabela
create table if not exists public.faturamentos (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete restrict,
  empresa_id             uuid not null references public.empresas(id) on delete restrict,
  origem_tipo            faturamento_origem not null,
  origem_id              uuid,
  cliente_id             uuid references public.clientes(id) on delete restrict,
  fornecedor_id          uuid references public.fornecedores(id) on delete restrict,
  numero_nf              text not null,
  serie                  text not null,
  data_emissao           date not null,
  valor_total            numeric(14, 2) not null,
  descricao              text not null,
  anexo_nf_path          text not null,
  plano_conta_tipo_id    uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  status                 faturamento_status not null default 'emitido',
  cancelado_em           timestamptz,
  cancelado_por          uuid references public.profiles(id),
  motivo_cancelamento    text,
  emitido_em             timestamptz not null default now(),
  emitido_por            uuid not null references public.profiles(id),

  constraint chk_faturamento_contraparte check (
    (origem_tipo in ('job','avulso') and cliente_id is not null and fornecedor_id is null)
    or
    (origem_tipo = 'bv' and fornecedor_id is not null and cliente_id is null)
  ),
  constraint chk_faturamento_origem check (
    (origem_tipo = 'avulso' and origem_id is null)
    or
    (origem_tipo in ('job','bv') and origem_id is not null)
  ),
  constraint chk_faturamento_valor_positivo check (valor_total > 0),
  constraint chk_faturamento_descricao_nao_vazia check (length(trim(descricao)) >= 3),
  constraint chk_faturamento_cancelado check (
    (status = 'cancelado' and cancelado_em is not null and cancelado_por is not null)
    or
    (status = 'emitido' and cancelado_em is null and cancelado_por is null and motivo_cancelamento is null)
  )
);

-- 3) Índices
create index if not exists idx_faturamentos_tenant on public.faturamentos(tenant_id);
create index if not exists idx_faturamentos_origem
  on public.faturamentos(tenant_id, origem_tipo, origem_id);
create index if not exists idx_faturamentos_status
  on public.faturamentos(tenant_id, status);
create index if not exists idx_faturamentos_cliente on public.faturamentos(cliente_id);
create index if not exists idx_faturamentos_fornecedor on public.faturamentos(fornecedor_id);
create index if not exists idx_faturamentos_empresa on public.faturamentos(empresa_id);

-- 4) RLS + GRANT
alter table public.faturamentos enable row level security;

drop policy if exists faturamentos_select on public.faturamentos;
create policy faturamentos_select on public.faturamentos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists faturamentos_insert on public.faturamentos;
create policy faturamentos_insert on public.faturamentos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists faturamentos_update on public.faturamentos;
create policy faturamentos_update on public.faturamentos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.faturamentos to authenticated;

-- 5) Storage bucket privado
insert into storage.buckets (id, name, public)
values ('faturamentos-nf', 'faturamentos-nf', false)
on conflict (id) do nothing;

drop policy if exists faturamentos_storage_select on storage.objects;
create policy faturamentos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'faturamentos-nf'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists faturamentos_storage_insert on storage.objects;
create policy faturamentos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'faturamentos-nf'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists faturamentos_storage_delete on storage.objects;
create policy faturamentos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'faturamentos-nf'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );
