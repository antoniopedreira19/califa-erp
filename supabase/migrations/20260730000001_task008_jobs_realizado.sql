-- =====================================================================
-- Task 008 — Realizado por item de job
-- Ver spec: docs/superpowers/specs/2026-07-30-jobs-realizado-design.md
-- =====================================================================

-- 1. Tabela jobs_itens_realizado (1:1 job x item da versao aprovada)
create table if not exists public.jobs_itens_realizado (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  job_id                    uuid not null references public.jobs(id) on delete cascade,
  item_id                   uuid not null references public.versoes_orcamento_itens(id) on delete cascade,
  valor_unitario_realizado  numeric(14,2) not null default 0,
  quantidade_realizada      numeric(12,3) not null default 0,
  dias_meses_realizado      numeric(12,3) not null default 0,
  total_realizado           numeric(18,2) generated always as (
                              coalesce(valor_unitario_realizado, 0)
                              * coalesce(quantidade_realizada, 0)
                              * coalesce(dias_meses_realizado, 0)
                            ) stored,
  created_by                uuid references public.profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint uniq_realizado_por_job_item unique (job_id, item_id),
  constraint realizado_valor_nao_negativo      check (valor_unitario_realizado >= 0),
  constraint realizado_quantidade_nao_negativa check (quantidade_realizada    >= 0),
  constraint realizado_dias_meses_nao_negativo check (dias_meses_realizado    >= 0)
);

create index if not exists idx_jobs_realizado_tenant on public.jobs_itens_realizado(tenant_id);
create index if not exists idx_jobs_realizado_job on public.jobs_itens_realizado(job_id);
create index if not exists idx_jobs_realizado_item on public.jobs_itens_realizado(item_id);

-- 2. Trigger updated_at
drop trigger if exists trg_jobs_realizado_updated_at on public.jobs_itens_realizado;
create trigger trg_jobs_realizado_updated_at
before update on public.jobs_itens_realizado
for each row execute function public.set_updated_at();

-- 3. RLS — is_tenant_member em todas as operacoes
alter table public.jobs_itens_realizado enable row level security;

drop policy if exists jobs_realizado_select on public.jobs_itens_realizado;
create policy jobs_realizado_select on public.jobs_itens_realizado
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_realizado_insert on public.jobs_itens_realizado;
create policy jobs_realizado_insert on public.jobs_itens_realizado
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_realizado_update on public.jobs_itens_realizado;
create policy jobs_realizado_update on public.jobs_itens_realizado
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_realizado_delete on public.jobs_itens_realizado;
create policy jobs_realizado_delete on public.jobs_itens_realizado
  for delete to authenticated using (public.is_tenant_member(tenant_id));

-- 4. GRANTs authenticated (service_role coberto por ALTER DEFAULT PRIVILEGES)
grant select, insert, update, delete on public.jobs_itens_realizado to authenticated;
