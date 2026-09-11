-- =====================================================================
-- Empresas contábeis: PJ real, definida por CNPJ, dona das contas
-- bancárias. Separada da tabela `empresas` (gerencial) porque a operação
-- da California tem 3 PJs contábeis (California LTDA, Hitlab LTDA,
-- GoCrazy LTDA) que não batem 1:1 com as empresas gerenciais (CCH é
-- gerencial e não tem CNPJ próprio; GoCrazy é contábil e não é
-- gerencial). Spec: docs/superpowers/specs/2026-09-11-empresas-contabeis-design.md
-- =====================================================================

create table public.empresas_contabeis (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  razao_social   text not null,
  nome_fantasia  text,
  cnpj           text not null,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  constraint empresas_contabeis_cnpj_tenant_uk unique (tenant_id, cnpj),
  constraint empresas_contabeis_cnpj_digits_chk check (cnpj ~ '^[0-9]{14}$')
);

create index empresas_contabeis_tenant_ativo_idx
  on public.empresas_contabeis (tenant_id, ativo);

alter table public.empresas_contabeis enable row level security;

create policy empresas_contabeis_select
  on public.empresas_contabeis
  for select
  using (tenant_id in (select current_tenant_ids()));

create policy empresas_contabeis_modify
  on public.empresas_contabeis
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

grant select, insert, update, delete on public.empresas_contabeis to authenticated;

comment on table public.empresas_contabeis is
  'Pessoa jurídica contábil (CNPJ). Dona das contas bancárias. Distinta da tabela empresas (gerencial) — a California opera com 3 PJs contábeis que não batem 1:1 com as empresas gerenciais.';
