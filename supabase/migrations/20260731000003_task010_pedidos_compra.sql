-- =====================================================================
-- Task 010 fase 1 — Pedidos de Compra (emissao + cancelamento)
-- Ver spec: docs/superpowers/specs/2026-07-31-pedidos-compra-design.md
-- =====================================================================

-- 1. jobs_itens_realizado ganha fornecedor_id (populado ao gerar PP)
alter table public.jobs_itens_realizado
  add column if not exists fornecedor_id uuid
    references public.fornecedores(id) on delete restrict;

create index if not exists idx_realizado_fornecedor
  on public.jobs_itens_realizado(fornecedor_id);

-- 2. pedidos_compra (1:1 com item_realizado)
create table if not exists public.pedidos_compra (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  codigo                text not null,

  item_realizado_id     uuid not null references public.jobs_itens_realizado(id) on delete restrict,
  job_id                uuid not null references public.jobs(id) on delete restrict,
  fornecedor_id         uuid not null references public.fornecedores(id) on delete restrict,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,

  servico               text not null,
  quantidade            numeric(12,3) not null,
  especificacoes        text,
  valor                 numeric(14,2) not null,
  prazo_pagamento       date not null,

  pdf_path              text not null,

  emitida_por           uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uniq_pp_por_item_realizado unique (item_realizado_id),
  constraint uniq_pp_codigo_por_tenant  unique (tenant_id, codigo),
  constraint pp_servico_nao_vazio       check (length(trim(servico)) > 0),
  constraint pp_quantidade_positiva     check (quantidade > 0),
  constraint pp_valor_positivo          check (valor > 0)
);

create index if not exists idx_pp_tenant on public.pedidos_compra(tenant_id);
create index if not exists idx_pp_job on public.pedidos_compra(job_id);
create index if not exists idx_pp_fornecedor on public.pedidos_compra(fornecedor_id);
create index if not exists idx_pp_empresa on public.pedidos_compra(empresa_id);

drop trigger if exists trg_pp_updated_at on public.pedidos_compra;
create trigger trg_pp_updated_at
before update on public.pedidos_compra
for each row execute function public.set_updated_at();

-- 3. Anexos (N por PP, obrigatorio >=1 no server action)
create table if not exists public.pedidos_compra_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id      uuid not null references public.pedidos_compra(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint anexo_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index if not exists idx_pp_anexos_pp on public.pedidos_compra_anexos(pedido_compra_id);
create index if not exists idx_pp_anexos_tenant on public.pedidos_compra_anexos(tenant_id);

-- 4. RLS + GRANTs
alter table public.pedidos_compra enable row level security;
alter table public.pedidos_compra_anexos enable row level security;

drop policy if exists pp_select on public.pedidos_compra;
create policy pp_select on public.pedidos_compra
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists pp_insert on public.pedidos_compra;
create policy pp_insert on public.pedidos_compra
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
drop policy if exists pp_update on public.pedidos_compra;
create policy pp_update on public.pedidos_compra
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
drop policy if exists pp_delete on public.pedidos_compra;
create policy pp_delete on public.pedidos_compra
  for delete to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_anexos_select on public.pedidos_compra_anexos;
create policy pp_anexos_select on public.pedidos_compra_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists pp_anexos_insert on public.pedidos_compra_anexos;
create policy pp_anexos_insert on public.pedidos_compra_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
drop policy if exists pp_anexos_delete on public.pedidos_compra_anexos;
create policy pp_anexos_delete on public.pedidos_compra_anexos
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.pedidos_compra to authenticated;
grant select, insert, delete on public.pedidos_compra_anexos to authenticated;

-- 5. Bucket privado pedidos-compra
insert into storage.buckets (id, name, public)
values ('pedidos-compra', 'pedidos-compra', false)
on conflict (id) do nothing;

drop policy if exists pp_storage_select on storage.objects;
create policy pp_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists pp_storage_insert on storage.objects;
create policy pp_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists pp_storage_delete on storage.objects;
create policy pp_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

-- 6. Sequencial PP-NNNNN por tenant (funcao com lock)
create or replace function public.gerar_codigo_pp(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prox integer;
  v_codigo text;
begin
  perform pg_advisory_xact_lock(hashtext('pp_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^PP-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.pedidos_compra
    where tenant_id = p_tenant_id
      and codigo ~ '^PP-\d+$';

  v_codigo := 'PP-' || lpad(v_prox::text, 5, '0');
  return v_codigo;
end;
$$;

grant execute on function public.gerar_codigo_pp(uuid) to authenticated;
