-- =====================================================================
-- A foto de cada registro da abertura — decisão 059 (08/09/2026)
--
-- Até aqui a revisão da abertura (depois de uma errata) e a edição livre
-- do registro sobrescreviam `jobs` e regravavam as previsões: o que a
-- abertura dizia ANTES só sobrevivia no de/para da auditoria. O
-- financeiro pediu para ver a abertura original e cada revisão, e para
-- revisar OLHANDO a anterior — então cada registro confirmado vira uma
-- linha aqui, imutável.
--
-- Uma linha por confirmação:
--   numero 1           → a abertura ("Abrir job no financeiro")
--   numero 2, 3, …     → cada revisão de errata ou edição do registro
--
-- O conteúdo é o que o formulário confirmou: nome no financeiro,
-- projeto, contas, categoria, serviço, rateio de competência, curva de
-- desembolso e parcelas de recebimento (as duas em jsonb, porque a foto
-- não é consultada por parcela — é aberta inteira, para leitura), e os
-- três totais que davam a base naquele momento.
--
-- Sem UPDATE nem DELETE, nem na policy nem no grant: foto não se
-- retoca. Errou, registra outra.
--
-- BACKFILL (decisão do Tiago, 08/09/2026): os jobs já abertos ganham a
-- foto nº 1 reconstituída do estado ATUAL, marcada `reconstituida`. Se o
-- registro já tinha sido editado antes de hoje, essa foto é do último
-- estado, não do dia da abertura — o que houve antes fica na auditoria.
-- Os totais da foto reconstituída usam os valores congelados na abertura
-- (`valor_job_abertura`, `faturamento_previsto_abertura`), quando
-- existem, porque eles é que dizem sobre que base a abertura foi feita.
-- =====================================================================

create table if not exists public.jobs_aberturas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  numero           smallint not null,
  tipo             text not null
                     check (tipo in ('abertura', 'revisao_errata', 'edicao')),
  errata_id        uuid references public.jobs_erratas(id) on delete set null,
  reconstituida    boolean not null default false,
  registrado_em    timestamptz not null default now(),
  registrado_por   uuid references public.profiles(id) on delete set null,

  nome_financeiro       text,
  projeto_financeiro_id uuid,
  conta_recebimento_id  uuid,
  conta_pagamento_id    uuid,
  categoria_id          uuid,
  servico_id            uuid,
  competencias          jsonb not null default '[]'::jsonb,
  curva                 jsonb not null default '[]'::jsonb,
  recebimento           jsonb not null default '[]'::jsonb,
  valor_job             numeric(14,2),
  faturamento_previsto  numeric(14,2),
  custo_previsto        numeric(14,2),

  unique (job_id, numero)
);

create index if not exists idx_jobs_aberturas_job
  on public.jobs_aberturas (job_id, numero);
create index if not exists idx_jobs_aberturas_tenant
  on public.jobs_aberturas (tenant_id);
create index if not exists idx_jobs_aberturas_errata
  on public.jobs_aberturas (errata_id);
create index if not exists idx_jobs_aberturas_registrado_por
  on public.jobs_aberturas (registrado_por);

alter table public.jobs_aberturas enable row level security;

drop policy if exists jobs_aberturas_select on public.jobs_aberturas;
create policy jobs_aberturas_select on public.jobs_aberturas
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_aberturas_insert on public.jobs_aberturas;
create policy jobs_aberturas_insert on public.jobs_aberturas
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

grant select, insert on public.jobs_aberturas to authenticated;

comment on table public.jobs_aberturas is
  'Foto de cada registro da abertura do job confirmado no financeiro: a abertura (numero 1) e cada revisao de errata ou edicao do registro depois dela. Imutavel — sem update nem delete (decisao 059).';
comment on column public.jobs_aberturas.tipo is
  'abertura = "Abrir job no financeiro"; revisao_errata = "Registrar revisao de abertura" depois de uma errata; edicao = "Editar registro" livre.';
comment on column public.jobs_aberturas.reconstituida is
  'true na foto nº 1 dos jobs abertos antes desta tabela existir: ela foi montada do estado atual na migration, nao do dia da abertura.';
comment on column public.jobs_aberturas.competencias is
  'Rateio de competencia confirmado: [{trimestre, ano, percentual}].';
comment on column public.jobs_aberturas.curva is
  'Cronograma de desembolsos confirmado: [{data_prevista, valor}].';
comment on column public.jobs_aberturas.recebimento is
  'Parcelas de recebimento confirmadas: [{data_prevista, valor}].';

-- Foto nº 1, reconstituída, para todo job que o financeiro já abriu.
insert into public.jobs_aberturas (
  tenant_id, job_id, numero, tipo, reconstituida,
  registrado_em, registrado_por,
  nome_financeiro, projeto_financeiro_id, conta_recebimento_id,
  conta_pagamento_id, categoria_id, servico_id,
  competencias, curva, recebimento,
  valor_job, faturamento_previsto, custo_previsto
)
select
  j.tenant_id, j.id, 1, 'abertura', true,
  coalesce(j.data_abertura_financeiro, j.updated_at), j.aberto_por,
  j.nome_financeiro, j.projeto_financeiro_id, j.conta_recebimento_id,
  j.conta_pagamento_id, j.categoria_id, j.servico_id,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'trimestre', c.trimestre, 'ano', c.ano, 'percentual', c.percentual)
           order by c.ano, c.trimestre)
      from public.jobs_competencias c where c.job_id = j.id
  ), '[]'::jsonb),
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'data_prevista', p.data_prevista, 'valor', p.valor)
           order by p.data_prevista, p.ordem)
      from public.jobs_previsao_custo p where p.job_id = j.id
  ), '[]'::jsonb),
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'data_prevista', p.data_prevista, 'valor', p.valor)
           order by p.data_prevista, p.ordem)
      from public.jobs_previsao_recebimento p where p.job_id = j.id
  ), '[]'::jsonb),
  coalesce(j.valor_job_abertura, j.valor_total),
  coalesce(j.faturamento_previsto_abertura, j.faturamento_previsto),
  j.custo_previsto_total
from public.jobs j
where j.data_abertura_financeiro is not null
  and not exists (
    select 1 from public.jobs_aberturas a where a.job_id = j.id
  );
