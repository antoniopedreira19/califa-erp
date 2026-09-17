-- =====================================================================
-- RH — Fase 5: colaboradores_alocacoes (Camada 1 — timeline vigente)
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Timeline de alocações de cada colaborador em par (empresa, regional),
-- com percentual de rateio. N linhas podem coexistir com data_fim IS
-- NULL — alocação múltipla simultânea (ex.: 60% California-SP + 40%
-- CCH-Doca). É a Camada 1 do modelo em duas camadas:
--
--   Camada 1: colaboradores_alocacoes  — mutável pelo RH, é o "hoje"
--   Camada 2: folhas_pagamento_alocacoes — snapshot imutável por folha
--
-- REGRA CENTRAL — soma = 100 por colaborador
--
-- Em qualquer instante, a soma dos `percentual` das linhas vigentes
-- (data_fim IS NULL) de um mesmo colaborador é = 100.00 (ou 0 quando
-- ainda não há alocação).
--
-- Aceita soma=0 porque:
--   • Cadastro rápido: RH cria colaborador antes de definir alocação
--   • Fechamento total: RH pode fechar todas as alocações antes de
--     abrir as novas (embora o normal seja swap atômico via server
--     action, ver abaixo)
--
-- SWAP ATÔMICO
--
-- Mudança de 100% California-SP para 50/50 California-SP + CCH-Doca:
--   1. UPDATE alocação antiga SET data_fim = today  → sum(vigentes) = 0
--   2. INSERT nova SP com percentual = 50           → sum(vigentes) = 50
--   3. INSERT nova Doca com percentual = 50         → sum(vigentes) = 100
--   4. COMMIT
--
-- Se o trigger fosse imediato, o passo 2 falharia (sum=50). Solução: o
-- trigger é CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED — a
-- validação roda no COMMIT, quando o estado final está correto. Mesmo
-- padrão dos triggers de rateio já usados em contas_avulsas_regionais,
-- desembolsos_regionais e faturamentos_regionais.
--
-- Não sobreposição temporal por (colaborador, empresa, regional) fica
-- coberta implicitamente: fechar linha antiga antes de abrir nova é
-- responsabilidade da server action; sobreposição acidental viola a
-- soma=100 e o trigger derruba.
--
-- Dependências:
--   • public.tenants                     — Task 001
--   • public.colaboradores               — Fase 4 (20260916000005)
--   • public.empresas                    — Task 009
--   • public.regionais                   — hierarquia consolidada em 20260908000001
--   • public.profiles                    — Task 001
--   • public.is_tenant_admin(uuid), is_tenant_rh(uuid)
--
-- DELETE liberado para admin/rh — escape hatch para erro de digitação
-- (padrão análogo ao de empresa_members e contas_avulsas_regionais).
--
-- Aditivo do começo ao fim.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------

create table if not exists public.colaboradores_alocacoes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  colaborador_id  uuid not null references public.colaboradores(id) on delete cascade,
  empresa_id      uuid not null references public.empresas(id) on delete restrict,
  regional_id     uuid not null references public.regionais(id) on delete restrict,

  percentual      numeric(5,2) not null,
  data_inicio     date not null,
  data_fim        date,
  motivo          text,

  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),

  constraint chk_alocacoes_percentual_valido check (percentual > 0 and percentual <= 100),
  constraint chk_alocacoes_periodo_valido    check (data_fim is null or data_fim >= data_inicio)
);

comment on table public.colaboradores_alocacoes is
  'Camada 1 — alocacao vigente do colaborador em par (empresa, regional). N linhas simultaneas por colaborador, somando percentual=100 quando data_fim IS NULL. Base para o rateio da folha na Camada 2.';
comment on column public.colaboradores_alocacoes.percentual is
  'Rateio da alocacao (0.01 a 100.00). Soma das linhas vigentes de um mesmo colaborador = 100.00 — validado no commit por constraint trigger.';
comment on column public.colaboradores_alocacoes.data_fim is
  'NULL = vigente. Fechar linha antiga antes de abrir nova e responsabilidade da server action, em transacao (swap atomico).';
comment on column public.colaboradores_alocacoes.motivo is
  'Livre. Padrao esperado: reorganizacao, mudanca de squad, saida de conta, novo produto.';


-- ---------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------

create index if not exists idx_alocacoes_colaborador
  on public.colaboradores_alocacoes (colaborador_id);

create index if not exists idx_alocacoes_empresa
  on public.colaboradores_alocacoes (empresa_id);

create index if not exists idx_alocacoes_regional
  on public.colaboradores_alocacoes (regional_id);

create index if not exists idx_alocacoes_vigentes
  on public.colaboradores_alocacoes (colaborador_id)
  where data_fim is null;

create index if not exists idx_alocacoes_tenant
  on public.colaboradores_alocacoes (tenant_id);


-- ---------------------------------------------------------------------
-- 3. Função de checagem de soma
-- ---------------------------------------------------------------------
--
-- Modelo copiado de enforce_rateio_soma_100_avulsa (precedente do
-- sistema). Aceita sum=0 (sem linha vigente); se houver, precisa somar
-- 100.00 com tolerância de 0.01 para arredondamento.
--
-- Retorno NULL é aceitável em trigger AFTER FOR EACH ROW (o valor é
-- ignorado; o que importa é RAISE EXCEPTION).

create or replace function public.enforce_alocacao_colaborador_soma_100()
returns trigger
language plpgsql
as $$
declare
  v_colaborador_id uuid;
  v_soma           numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_colaborador_id := old.colaborador_id;
  else
    v_colaborador_id := new.colaborador_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.colaboradores_alocacoes
   where colaborador_id = v_colaborador_id
     and data_fim is null;

  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'Rateio de alocacoes do colaborador % soma %, deve ser 100.00.',
      v_colaborador_id, v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

comment on function public.enforce_alocacao_colaborador_soma_100() is
  'Verifica que a soma dos percentuais das alocacoes VIGENTES (data_fim IS NULL) de um colaborador e 100.00 ou 0 (sem alocacao). Usada por CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED em colaboradores_alocacoes — dispara no COMMIT.';


-- ---------------------------------------------------------------------
-- 4. Constraint trigger (deferrable initially deferred)
-- ---------------------------------------------------------------------

drop trigger if exists trg_alocacoes_soma_100 on public.colaboradores_alocacoes;
create constraint trigger trg_alocacoes_soma_100
  after insert or update or delete
  on public.colaboradores_alocacoes
  deferrable initially deferred
  for each row
  execute function public.enforce_alocacao_colaborador_soma_100();


-- ---------------------------------------------------------------------
-- 5. RLS + policies (admin OR rh — inclui DELETE)
-- ---------------------------------------------------------------------

alter table public.colaboradores_alocacoes enable row level security;

drop policy if exists alocacoes_select on public.colaboradores_alocacoes;
create policy alocacoes_select on public.colaboradores_alocacoes
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists alocacoes_insert on public.colaboradores_alocacoes;
create policy alocacoes_insert on public.colaboradores_alocacoes
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists alocacoes_update on public.colaboradores_alocacoes;
create policy alocacoes_update on public.colaboradores_alocacoes
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists alocacoes_delete on public.colaboradores_alocacoes;
create policy alocacoes_delete on public.colaboradores_alocacoes
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));


-- ---------------------------------------------------------------------
-- 6. GRANT (inclui DELETE)
-- ---------------------------------------------------------------------

grant select, insert, update, delete on public.colaboradores_alocacoes to authenticated;
