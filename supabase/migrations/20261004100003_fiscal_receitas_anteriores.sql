-- =====================================================================
-- Receita recebida antes do início da Apuração, para a LC 224/2025
-- (decisão 145, item 7 — Tiago, 04/10/2026: "se o indicado for o correto,
-- pode implementar")
-- =====================================================================
--
-- No lucro presumido, o acréscimo de 10% na presunção (32% → 35,2%) vale só
-- sobre a receita acima de R$ 5 milhões no ano, controlada por trimestre:
-- R$ 1,25 milhão por trimestre, a sobra de um trimestre passa para os
-- seguintes do mesmo ano, e o 4º trimestre confere o ano inteiro (IN RFB
-- 2.305/2025, art. 15, na redação da IN 2.306/2026). A Apuração começa em
-- outubro/2026: a receita de janeiro a setembro não está no sistema. O
-- financeiro a informa aqui, por PJ e trimestre, à mão. Sem ela, o motor usa
-- o limite do próprio trimestre (erra para mais) e avisa.
--
-- Aditiva: uma tabela nova, com RLS, grants e índices nos moldes das outras
-- tabelas do cadastro de impostos (`fiscal_*`).
-- =====================================================================

create table if not exists public.fiscal_receitas_anteriores (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete restrict,
  empresa_contabil_id  uuid not null references public.empresas_contabeis(id) on delete restrict,
  trimestre            text not null check (trimestre ~ '^[0-9]{4}-T[1-4]$'),
  receita_bruta        numeric(14, 2) not null check (receita_bruta >= 0),
  observacao           text,
  informado_por        uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_fiscal_receita_anterior unique (tenant_id, empresa_contabil_id, trimestre)
);

comment on table public.fiscal_receitas_anteriores is
  'Receita bruta recebida por PJ e trimestre antes do início da Apuração (outubro/2026), informada à mão: alimenta a sobra de limite e o ajuste do ano da LC 224/2025 no lucro presumido (decisão 145).';

create index if not exists idx_fiscal_receitas_anteriores_pj on public.fiscal_receitas_anteriores (empresa_contabil_id);
create index if not exists idx_fiscal_receitas_anteriores_autor on public.fiscal_receitas_anteriores (informado_por);

drop trigger if exists trg_fiscal_receitas_anteriores_updated_at on public.fiscal_receitas_anteriores;
create trigger trg_fiscal_receitas_anteriores_updated_at
  before update on public.fiscal_receitas_anteriores
  for each row execute function public.set_updated_at();

alter table public.fiscal_receitas_anteriores enable row level security;

drop policy if exists fiscal_receitas_anteriores_select on public.fiscal_receitas_anteriores;
create policy fiscal_receitas_anteriores_select on public.fiscal_receitas_anteriores
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists fiscal_receitas_anteriores_modify on public.fiscal_receitas_anteriores;
create policy fiscal_receitas_anteriores_modify on public.fiscal_receitas_anteriores
  for all to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)))
  with check (tenant_id in (select public.current_tenant_ids())
              and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

revoke all on table public.fiscal_receitas_anteriores from public, anon;
grant select, insert, update, delete on table public.fiscal_receitas_anteriores to authenticated;
