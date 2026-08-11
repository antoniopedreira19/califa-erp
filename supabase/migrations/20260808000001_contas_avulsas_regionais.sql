-- =====================================================================
-- Task 014 — Rateio de regional em contas avulsas e templates recorrentes
-- Ver spec: docs/superpowers/specs/2026-08-08-rateio-regional-avulsa-design.md
-- =====================================================================

-- 1) Tabela de rateio da conta avulsa
create table if not exists public.contas_avulsas_regionais (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id   uuid not null references public.contas_avulsas(id) on delete cascade,
  regional_id       uuid not null references public.regionais(id) on delete restrict,
  percentual        numeric(5,2) not null,
  created_at        timestamptz not null default now(),

  constraint chk_avulsa_rateio_percentual_range
    check (percentual > 0 and percentual <= 100),
  constraint uniq_avulsa_regional
    unique (conta_avulsa_id, regional_id)
);

create index if not exists idx_avulsa_rateio_conta on public.contas_avulsas_regionais(conta_avulsa_id);
create index if not exists idx_avulsa_rateio_tenant on public.contas_avulsas_regionais(tenant_id);
create index if not exists idx_avulsa_rateio_regional on public.contas_avulsas_regionais(regional_id);

alter table public.contas_avulsas_regionais enable row level security;

drop policy if exists avulsa_rateio_select on public.contas_avulsas_regionais;
create policy avulsa_rateio_select on public.contas_avulsas_regionais
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_rateio_insert on public.contas_avulsas_regionais;
create policy avulsa_rateio_insert on public.contas_avulsas_regionais
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_rateio_update on public.contas_avulsas_regionais;
create policy avulsa_rateio_update on public.contas_avulsas_regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists avulsa_rateio_delete on public.contas_avulsas_regionais;
create policy avulsa_rateio_delete on public.contas_avulsas_regionais
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_regionais to authenticated;

-- 2) Tabela de rateio do template recorrente
create table if not exists public.contas_avulsas_recorrentes_regionais (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  recorrente_id     uuid not null references public.contas_avulsas_recorrentes(id) on delete cascade,
  regional_id       uuid not null references public.regionais(id) on delete restrict,
  percentual        numeric(5,2) not null,
  created_at        timestamptz not null default now(),

  constraint chk_rec_rateio_percentual_range
    check (percentual > 0 and percentual <= 100),
  constraint uniq_rec_regional
    unique (recorrente_id, regional_id)
);

create index if not exists idx_rec_rateio_recorrente on public.contas_avulsas_recorrentes_regionais(recorrente_id);
create index if not exists idx_rec_rateio_tenant on public.contas_avulsas_recorrentes_regionais(tenant_id);
create index if not exists idx_rec_rateio_regional on public.contas_avulsas_recorrentes_regionais(regional_id);

alter table public.contas_avulsas_recorrentes_regionais enable row level security;

drop policy if exists rec_rateio_select on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_select on public.contas_avulsas_recorrentes_regionais
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists rec_rateio_insert on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_insert on public.contas_avulsas_recorrentes_regionais
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_rateio_update on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_update on public.contas_avulsas_recorrentes_regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists rec_rateio_delete on public.contas_avulsas_recorrentes_regionais;
create policy rec_rateio_delete on public.contas_avulsas_recorrentes_regionais
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_recorrentes_regionais to authenticated;

-- 3) Função + trigger DEFERRABLE de validação de soma pra avulsa
create or replace function public.enforce_rateio_soma_100_avulsa()
returns trigger
language plpgsql
as $$
declare
  v_conta_id uuid;
  v_soma numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_conta_id := old.conta_avulsa_id;
  else
    v_conta_id := new.conta_avulsa_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.contas_avulsas_regionais
   where conta_avulsa_id = v_conta_id;

  -- Aceita soma = 0 (delete-all antes de insert-all).
  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'Rateio de regional da conta % soma %, deve ser 100.00.',
      v_conta_id, v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_avulsa_rateio_soma on public.contas_avulsas_regionais;
create constraint trigger trg_avulsa_rateio_soma
  after insert or update or delete on public.contas_avulsas_regionais
  deferrable initially deferred
  for each row execute function public.enforce_rateio_soma_100_avulsa();

-- 4) Função + trigger análogos pro template recorrente
create or replace function public.enforce_rateio_soma_100_recorrente()
returns trigger
language plpgsql
as $$
declare
  v_recorrente_id uuid;
  v_soma numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_recorrente_id := old.recorrente_id;
  else
    v_recorrente_id := new.recorrente_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.contas_avulsas_recorrentes_regionais
   where recorrente_id = v_recorrente_id;

  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'Rateio de regional do template % soma %, deve ser 100.00.',
      v_recorrente_id, v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_rec_rateio_soma on public.contas_avulsas_recorrentes_regionais;
create constraint trigger trg_rec_rateio_soma
  after insert or update or delete on public.contas_avulsas_recorrentes_regionais
  deferrable initially deferred
  for each row execute function public.enforce_rateio_soma_100_recorrente();

-- GRANTs por tabela acima (padrão do projeto: grant select/insert/update/delete segue cada bloco de CREATE TABLE + RLS, sem GRANT geral no fim do arquivo).
