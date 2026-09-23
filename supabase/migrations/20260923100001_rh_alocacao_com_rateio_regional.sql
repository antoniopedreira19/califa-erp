-- =====================================================================
-- RH — Alocação por empresa + tabela de rateio anual por regional
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O modelo original de alocação (MVP, migration 20260916000005) permitia
-- N linhas por colaborador em (empresa_id, regional_id, percentual)
-- somando 100 — validado por trigger. Na prática, isso resolve um caso
-- que não existe (colaborador dividido entre EMPRESAS diferentes) e
-- deixa o caso real mal-modelado (Diretor Comercial Nacional, backoffice,
-- etc: rateio EM UMA MESMA empresa por várias regionais).
--
-- Na planilha real da Kika, colaborador transversal fica marcado com
-- regional "TD" (todas), e o custo é distribuído entre as regionais da
-- empresa conforme uma **tabela de rateio anual** (% por regional,
-- fechando 100 por empresa/ano). O que era workaround "GERAL" (removido
-- em 2026-09-23) vira toggle explícito.
--
-- Novo modelo:
--
--   • Colaborador tem UMA alocação vigente por vez (não N somando 100).
--   • Alocação = (empresa_id, usa_rateio_empresa boolean, regional_id?).
--   • Se usa_rateio_empresa=true, regional_id é NULL e o custo é
--     distribuído no snapshot da folha conforme empresas_rateios_regionais.
--   • Se usa_rateio_empresa=false, regional_id é obrigatório (regional
--     específica, 100% do custo ali).
--
-- Snapshot da folha continua sendo N linhas em folhas_pagamento_alocacoes
-- com % somando 100 — no momento da geração, o motor de folha EXPANDE a
-- alocação vigente do colaborador. Toggle=false vira 1 linha 100%;
-- toggle=true vira N linhas conforme rateio da empresa/ano.
--
-- Kika edita rateio 1×/ano por empresa (California, CCH). Empresa sem
-- rateio configurado (Empresa Teste, Hitlab) não permite toggle=true.
--
-- Ver tasks/active/006-alocacao-com-rateio-regional-na-folha.md.
--
-- O QUE MUDA
--
--   1. Nova tabela empresas_rateios_regionais (RLS admin+rh).
--   2. Backfill California + CCH nos anos 2023, 2024, 2025, 2026.
--   3. Regionais ganham unique (id, empresa_id) — permite composite FK
--      pra garantir que regional pertence à empresa.
--   4. colaboradores_alocacoes muda:
--       - drop trigger de soma=100
--       - drop function enforce_alocacao_colaborador_soma_100
--       - drop constraint chk_alocacoes_percentual_valido
--       - drop column percentual
--       - regional_id vira NULLABLE
--       - add usa_rateio_empresa boolean not null default false
--       - add check XOR (usa_rateio ⊕ regional específica)
--       - add composite FK (regional_id, empresa_id) → regionais(id, empresa_id)
--       - idx_alocacoes_vigentes vira UNIQUE (1 vigente por colaborador)
--   5. Backfill da alocação do único colaborador de teste (Antonio):
--      apaga as 2 vigentes de teste (50/50 Empresa Teste + CCH) e insere
--      uma nova em Empresa Teste + regional Teste (toggle=false).
--
-- Aditivo → destrutivo: a coluna percentual é removida com dado dentro
-- (era o rateio da alocação MULTIPLA). Confirmado com o usuário em
-- 2026-09-23: rateio agora é por empresa (tabela nova), não por
-- alocação individual — a coluna perdeu significado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Regionais ganha unique composto pra viabilizar composite FK
-- ---------------------------------------------------------------------

alter table public.regionais
  add constraint uniq_regionais_id_empresa
  unique (id, empresa_id);

-- ---------------------------------------------------------------------
-- 2) Nova tabela empresas_rateios_regionais
-- ---------------------------------------------------------------------

create table public.empresas_rateios_regionais (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  ano_vigencia   int  not null check (ano_vigencia between 2020 and 2099),
  regional_id    uuid not null,
  percentual     numeric(5,2) not null check (percentual > 0 and percentual <= 100),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  -- Garante que a regional pertence à empresa desse rateio.
  constraint fk_rateio_regional_pertence_empresa
    foreign key (regional_id, empresa_id)
    references public.regionais (id, empresa_id)
    on delete restrict,
  -- Uma linha por (empresa, ano, regional).
  constraint uniq_rateio_empresa_ano_regional
    unique (tenant_id, empresa_id, ano_vigencia, regional_id)
);

create index idx_rateios_empresa_ano
  on public.empresas_rateios_regionais (empresa_id, ano_vigencia);

create index idx_rateios_tenant
  on public.empresas_rateios_regionais (tenant_id);

comment on table public.empresas_rateios_regionais is
  'Tabela de rateio anual: % de distribuição do custo de colaboradores em toggle "todas as regionais" entre as regionais da empresa, por ano-calendário. Fonte-verdade única, editada 1×/ano pelo RH/admin. Regionais com 0% não viram linha.';
comment on column public.empresas_rateios_regionais.ano_vigencia is
  'Ano-calendário. Rateio vale de 01/jan a 31/dez desse ano; folhas geradas em qualquer competência do ano usam este rateio.';
comment on column public.empresas_rateios_regionais.percentual is
  'Percentual da regional no rateio da empresa naquele ano. Soma por (empresa, ano) deve ser exatamente 100 — validado por trigger.';

-- Trigger de soma = 100 por (empresa, ano)
create or replace function public.enforce_rateio_empresa_soma_100()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_empresa uuid;
  v_ano int;
  v_soma numeric(10,2);
begin
  v_empresa := coalesce(new.empresa_id, old.empresa_id);
  v_ano     := coalesce(new.ano_vigencia, old.ano_vigencia);

  select coalesce(sum(percentual), 0) into v_soma
  from public.empresas_rateios_regionais
  where empresa_id = v_empresa
    and ano_vigencia = v_ano;

  if v_soma <> 100 then
    raise exception 'Soma dos percentuais do rateio de % em % deve ser exatamente 100 (encontrado: %).',
      v_empresa, v_ano, v_soma;
  end if;

  return null;
end;
$$;

create constraint trigger trg_rateios_soma_100
  after insert or update or delete
  on public.empresas_rateios_regionais
  deferrable initially deferred
  for each row
  execute function public.enforce_rateio_empresa_soma_100();

-- Trigger function não deve ser chamável via RPC pública (Supabase advisor
-- lint 0028 / 0029). É interna do trigger.
revoke execute on function public.enforce_rateio_empresa_soma_100()
  from public, anon, authenticated;

-- RLS
alter table public.empresas_rateios_regionais enable row level security;

create policy "rateios select" on public.empresas_rateios_regionais
  for select
  to authenticated
  using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy "rateios insert" on public.empresas_rateios_regionais
  for insert
  to authenticated
  with check (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy "rateios update" on public.empresas_rateios_regionais
  for update
  to authenticated
  using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  )
  with check (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy "rateios delete" on public.empresas_rateios_regionais
  for delete
  to authenticated
  using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

grant select, insert, update, delete
  on public.empresas_rateios_regionais
  to authenticated;

-- ---------------------------------------------------------------------
-- 3) Backfill California + CCH (2023..2026)
--
-- California:
--   2023 → NE 26.5, NO 26.5, SP 27,  RJ 20
--   2024 → NE 27,   NO 19,   SP 27,  RJ 27
--   2025 → NE 25,   NO 20,   SP 30,  RJ 25
--   2026 → NE 25,   NO 20,   SP 30,  RJ 25
--
-- CCH (2023..2026): Doca 50, Agency 50
-- ---------------------------------------------------------------------

-- Como o trigger é DEFERRABLE INITIALLY DEFERRED, os inserts em batch
-- por (empresa, ano) podem ficar temporariamente com soma != 100 —
-- o check só roda no fim da transação (commit).

do $$
declare
  v_tenant uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_california uuid;
  v_cch uuid;
  v_ne uuid; v_no uuid; v_sp uuid; v_rj uuid;
  v_doca uuid; v_agency uuid;
begin
  select id into v_california from public.empresas
    where tenant_id = v_tenant and nome_fantasia = 'Agência California';
  select id into v_cch from public.empresas
    where tenant_id = v_tenant and nome_fantasia = 'CCH';

  select id into v_ne from public.regionais where empresa_id = v_california and nome = 'NE';
  select id into v_no from public.regionais where empresa_id = v_california and nome = 'NO';
  select id into v_sp from public.regionais where empresa_id = v_california and nome = 'SP';
  select id into v_rj from public.regionais where empresa_id = v_california and nome = 'RJ';

  select id into v_doca from public.regionais where empresa_id = v_cch and nome = 'Doca';
  select id into v_agency from public.regionais where empresa_id = v_cch and nome = 'Agency';

  insert into public.empresas_rateios_regionais
    (tenant_id, empresa_id, ano_vigencia, regional_id, percentual)
  values
    -- California
    (v_tenant, v_california, 2023, v_ne, 26.5),
    (v_tenant, v_california, 2023, v_no, 26.5),
    (v_tenant, v_california, 2023, v_sp, 27),
    (v_tenant, v_california, 2023, v_rj, 20),

    (v_tenant, v_california, 2024, v_ne, 27),
    (v_tenant, v_california, 2024, v_no, 19),
    (v_tenant, v_california, 2024, v_sp, 27),
    (v_tenant, v_california, 2024, v_rj, 27),

    (v_tenant, v_california, 2025, v_ne, 25),
    (v_tenant, v_california, 2025, v_no, 20),
    (v_tenant, v_california, 2025, v_sp, 30),
    (v_tenant, v_california, 2025, v_rj, 25),

    (v_tenant, v_california, 2026, v_ne, 25),
    (v_tenant, v_california, 2026, v_no, 20),
    (v_tenant, v_california, 2026, v_sp, 30),
    (v_tenant, v_california, 2026, v_rj, 25),

    -- CCH
    (v_tenant, v_cch, 2023, v_doca, 50),
    (v_tenant, v_cch, 2023, v_agency, 50),
    (v_tenant, v_cch, 2024, v_doca, 50),
    (v_tenant, v_cch, 2024, v_agency, 50),
    (v_tenant, v_cch, 2025, v_doca, 50),
    (v_tenant, v_cch, 2025, v_agency, 50),
    (v_tenant, v_cch, 2026, v_doca, 50),
    (v_tenant, v_cch, 2026, v_agency, 50);
end $$;

-- ---------------------------------------------------------------------
-- 4) Alter colaboradores_alocacoes
-- ---------------------------------------------------------------------

-- Drop trigger de soma=100 ANTES do delete — se o delete rodar primeiro,
-- ele agenda um evento no trigger DEFERRABLE INITIALLY DEFERRED e o
-- ALTER TABLE subsequente falha com "pending trigger events".
drop trigger if exists trg_alocacoes_soma_100
  on public.colaboradores_alocacoes;

drop function if exists public.enforce_alocacao_colaborador_soma_100();

-- Apaga as alocações vigentes do Antonio (as 2 de teste 50/50 que
-- quebrariam a nova unique de vigência). Dado de teste; usuário
-- confirmou (2026-09-23) que a nova alocação vira Empresa Teste +
-- regional "Teste" com toggle=false.
delete from public.colaboradores_alocacoes
where colaborador_id = '8c348178-8078-433c-a294-65a2154bd136'
  and data_fim is null;

-- Drop constraint de percentual válido.
alter table public.colaboradores_alocacoes
  drop constraint if exists chk_alocacoes_percentual_valido;

-- Drop coluna percentual.
alter table public.colaboradores_alocacoes
  drop column if exists percentual;

-- regional_id vira NULLABLE.
alter table public.colaboradores_alocacoes
  alter column regional_id drop not null;

-- Add usa_rateio_empresa.
alter table public.colaboradores_alocacoes
  add column usa_rateio_empresa boolean not null default false;

comment on column public.colaboradores_alocacoes.usa_rateio_empresa is
  'Se true, colaborador está em "Todas as regionais" da empresa: regional_id é NULL e o custo é expandido no snapshot da folha via empresas_rateios_regionais. Se false, regional_id é obrigatório e o custo fica 100% na regional específica.';

-- Check XOR: exatamente uma opção — regional específica OU rateio empresa.
alter table public.colaboradores_alocacoes
  add constraint chk_alocacao_regional_xor_rateio
  check (
    (usa_rateio_empresa = true  and regional_id is null) or
    (usa_rateio_empresa = false and regional_id is not null)
  );

-- Composite FK: se regional_id existe, tem que pertencer à empresa_id.
-- Como regional_id é nullable, a FK só valida quando ambos existem
-- (Postgres pula composite FK com qualquer coluna NULL por padrão MATCH SIMPLE).
alter table public.colaboradores_alocacoes
  add constraint fk_alocacao_regional_pertence_empresa
  foreign key (regional_id, empresa_id)
  references public.regionais (id, empresa_id)
  on delete restrict;

-- Índice de vigência vira UNIQUE (1 alocação vigente por colaborador).
drop index if exists public.idx_alocacoes_vigentes;

create unique index uniq_colaborador_alocacao_vigente
  on public.colaboradores_alocacoes (colaborador_id)
  where data_fim is null;

comment on index public.uniq_colaborador_alocacao_vigente is
  'Garante 1 alocação vigente por colaborador. Novo modelo (2026-09-23): alocação NÃO é mais fatiada em % entre empresas.';

-- ---------------------------------------------------------------------
-- 5) Backfill da alocação vigente do Antonio (Empresa Teste + Teste)
-- ---------------------------------------------------------------------

do $$
declare
  v_tenant uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_antonio uuid := '8c348178-8078-433c-a294-65a2154bd136';
  v_empresa_teste uuid;
  v_regional_teste uuid;
begin
  select id into v_empresa_teste from public.empresas
    where tenant_id = v_tenant and nome_fantasia = 'Empresa Teste';
  select id into v_regional_teste from public.regionais
    where empresa_id = v_empresa_teste and nome = 'Teste';

  insert into public.colaboradores_alocacoes
    (tenant_id, colaborador_id, empresa_id, regional_id,
     usa_rateio_empresa, data_inicio)
  values
    (v_tenant, v_antonio, v_empresa_teste, v_regional_teste,
     false, current_date);
end $$;
