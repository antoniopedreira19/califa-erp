-- Jobs internos de freelancer (fase 1 — fundação).
--
-- Contexto: a aba Freelancers precisa de "jobs" que agrupam freelancers
-- internos (ex.: time fixo da estrutura), SEM orçamento, PP, faturamento,
-- projeto, cliente ou empresa. É o mesmo conceito que existia nos "jobs"
-- do RH antigo — só nome e código, serve de rótulo pra agrupar contratos.
--
-- Decisão de modelagem (Opção C, 29/10/2026): tabela separada em vez de
-- flag na tabela `jobs`. A tabela `jobs` tem 7 colunas NOT NULL (projeto,
-- orçamento, versão aprovada, regional, responsável, empresa, cliente) que
-- não fazem sentido pra job interno, e relaxá-las espalha risco de leaking
-- em ~15-20 queries de produção. A tabela separada isola a feature no
-- módulo Freelancers e deixa `/jobs` intocado.
--
-- Mudanças aditivas (zero risco pra produção):
--   1. tabela `freelancer_jobs_internos` (id, tenant_id, codigo, nome,
--      descricao, arquivado_em, created_*/updated_*);
--   2. coluna `job_interno_id` em `freelancer_contratos` (nullable);
--   3. coluna `job_interno_id` em `freelancer_solicitacoes` (nullable);
--   4. CHECK em contratos: só UM dos dois (`job_id`, `job_interno_id`)
--      preenchido; e o CHECK antigo `job_obrigatorio_em_novos` passa a
--      aceitar `job_interno_id` como alternativa a `job_id`;
--   5. idem em solicitações;
--   6. reescrita da view `freelancers_com_status` com COALESCE pra que
--      `job_id`, `job_codigo`, `job_nome` sejam preenchidos por qualquer
--      uma das duas fontes (jobs ou jobs internos). As telas que consomem
--      a view não precisam mudar.
--
-- Soft delete via `arquivado_em`: job interno arquivado some do picker,
-- mas continua ligado a contratos antigos (histórico preservado).
--
-- Permissões: SELECT por todo o tenant (GP/produtor precisa ver pro
-- picker); INSERT/UPDATE por admin/rh/financeiro (mesmo nível de
-- "Gerenciar cargos").

begin;

-- 1. Tabela base ------------------------------------------------------------

create table if not exists public.freelancer_jobs_internos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  codigo text not null,
  nome text not null,
  descricao text,
  arquivado_em timestamptz,
  arquivado_por uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Código único por tenant (não globalmente — cada agência pode ter o
  -- seu "INT-01"). Permite reusar o código depois de arquivar: o unique
  -- considera só os ativos.
  constraint freelancer_jobs_internos_codigo_tenant_unique
    unique nulls not distinct (tenant_id, codigo),
  constraint freelancer_jobs_internos_codigo_nao_vazio
    check (btrim(codigo) <> ''),
  constraint freelancer_jobs_internos_nome_nao_vazio
    check (btrim(nome) <> '')
);

comment on table public.freelancer_jobs_internos is
  'Jobs internos de freelancer — rótulo pra agrupar contratos sem orçamento/projeto/cliente. Isolado da tabela `jobs` de produção (ADR 29/10/2026, Opção C).';

create index if not exists freelancer_jobs_internos_tenant_idx
  on public.freelancer_jobs_internos (tenant_id);

create index if not exists freelancer_jobs_internos_ativos_idx
  on public.freelancer_jobs_internos (tenant_id, codigo)
  where arquivado_em is null;

-- 2. Trigger de updated_at --------------------------------------------------

create or replace function public.freelancer_jobs_internos_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists freelancer_jobs_internos_updated_at
  on public.freelancer_jobs_internos;

create trigger freelancer_jobs_internos_updated_at
  before update on public.freelancer_jobs_internos
  for each row execute function public.freelancer_jobs_internos_set_updated_at();

-- 3. RLS + policies ---------------------------------------------------------

alter table public.freelancer_jobs_internos enable row level security;

-- SELECT: qualquer membro ativo do tenant. GP/produtor precisa enxergar
-- pra selecionar no JobPicker ao criar contrato/solicitação.
drop policy if exists freelancer_jobs_internos_select on public.freelancer_jobs_internos;
create policy freelancer_jobs_internos_select
  on public.freelancer_jobs_internos
  for select
  to authenticated
  using (is_tenant_member(tenant_id));

-- INSERT: admin + rh + financeiro.
drop policy if exists freelancer_jobs_internos_insert on public.freelancer_jobs_internos;
create policy freelancer_jobs_internos_insert
  on public.freelancer_jobs_internos
  for insert
  to authenticated
  with check (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

-- UPDATE: idem (inclui arquivar via UPDATE em `arquivado_em`).
drop policy if exists freelancer_jobs_internos_update on public.freelancer_jobs_internos;
create policy freelancer_jobs_internos_update
  on public.freelancer_jobs_internos
  for update
  to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  )
  with check (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

-- DELETE: só admin + rh (hard delete não é o caminho normal — preferir arquivar).
drop policy if exists freelancer_jobs_internos_delete on public.freelancer_jobs_internos;
create policy freelancer_jobs_internos_delete
  on public.freelancer_jobs_internos
  for delete
  to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

-- 4. GRANT --------------------------------------------------------------------

grant select, insert, update, delete on public.freelancer_jobs_internos to authenticated;

-- 5. Coluna job_interno_id em freelancer_contratos ---------------------------

alter table public.freelancer_contratos
  add column if not exists job_interno_id uuid
    references public.freelancer_jobs_internos(id) on delete set null;

create index if not exists freelancer_contratos_job_interno_id_idx
  on public.freelancer_contratos (job_interno_id)
  where job_interno_id is not null;

-- Trava: um contrato não pode apontar pros dois ao mesmo tempo.
alter table public.freelancer_contratos
  drop constraint if exists freelancer_contratos_job_exclusivo;
alter table public.freelancer_contratos
  add constraint freelancer_contratos_job_exclusivo
  check (job_id is null or job_interno_id is null);

-- Atualiza o CHECK antigo `job_obrigatorio_em_novos`: contrato do califa_erp
-- continua precisando de algum job, mas agora qualquer uma das duas fontes
-- serve.
alter table public.freelancer_contratos
  drop constraint if exists freelancer_contratos_job_obrigatorio_em_novos;
alter table public.freelancer_contratos
  add constraint freelancer_contratos_job_obrigatorio_em_novos
  check (
    origem_sistema = 'ag_california_rh'
    or job_id is not null
    or job_interno_id is not null
  );

-- 6. Coluna job_interno_id em freelancer_solicitacoes ------------------------

alter table public.freelancer_solicitacoes
  add column if not exists job_interno_id uuid
    references public.freelancer_jobs_internos(id) on delete restrict;

create index if not exists freelancer_solicitacoes_job_interno_id_idx
  on public.freelancer_solicitacoes (job_interno_id)
  where job_interno_id is not null;

-- Mesma trava: solicitação só aponta pra uma das duas fontes.
alter table public.freelancer_solicitacoes
  drop constraint if exists freelancer_solicitacoes_job_exclusivo;
alter table public.freelancer_solicitacoes
  add constraint freelancer_solicitacoes_job_exclusivo
  check (job_id is null or job_interno_id is null);

-- 7. Reescrita da view freelancers_com_status --------------------------------
--
-- Objetivo: as colunas `job_id`, `job_codigo`, `job_nome` passam a ser
-- COALESCE das duas fontes. Qualquer tela que lê a view (lista, perfil,
-- export) continua funcionando sem mudança.
--
-- Convenção: `job_id` passa a carregar o id da FONTE que preencheu — se
-- veio de jobs internos, o id é de `freelancer_jobs_internos`. O código
-- consumidor que precise distinguir pode consultar a nova coluna
-- `job_origem` ('producao' | 'interno' | null).

create or replace view public.freelancers_com_status
with (security_invoker = true) as
with contrato_ativo as (
  select distinct on (c.freelancer_id)
    c.id,
    c.tenant_id,
    c.freelancer_id,
    c.job_id,
    c.job_interno_id,
    c.responsavel_id,
    c.nome_job,
    c.cargo,
    c.tipo,
    c.valor,
    c.data_inicio,
    c.data_termino,
    c.cidade,
    c.observacoes,
    c.status_real,
    c.arquivo_url,
    c.minuta_url,
    c.data_termino_original,
    c.distrato_minuta_url,
    c.distrato_arquivo_url,
    c.distrato_data_proposta,
    c.distrato_motivo,
    c.distrato_solicitado_em,
    c.distrato_solicitado_por,
    c.origem_sistema,
    c.created_at,
    c.updated_at,
    c.created_by,
    c.updated_by
  from public.freelancer_contratos c
  order by
    c.freelancer_id,
    (case
      when c.data_inicio is not null and c.data_termino is not null
        and c.data_inicio <= current_date and c.data_termino >= current_date
        and c.status_real = true then 1
      when c.data_inicio is not null and c.data_inicio > current_date
        and c.status_real = true then 2
      else 3
    end),
    c.data_inicio desc nulls last,
    c.created_at desc
)
select
  f.id,
  f.tenant_id,
  f.nome_social,
  f.nome_completo,
  f.cpf,
  f.rg,
  f.data_nascimento,
  f.email,
  f.celular,
  f.cep,
  f.rua,
  f.numero,
  f.complemento,
  f.bairro,
  f.cidade,
  f.cnpj,
  f.razao_social,
  f.cartao_cnpj_url,
  f.tipo_pagamento,
  f.banco,
  f.agencia,
  f.conta,
  f.pix_chave,
  f.cor_raca,
  f.identidade_genero,
  f.deficiencia,
  f.saude_obs,
  f.contato_emergencia,
  f.acao_prevista,
  f.origem,
  f.created_at,
  f.updated_at,
  f.created_by,
  f.updated_by,
  ca.id as contrato_id,
  ca.origem_sistema as contrato_origem_sistema,
  coalesce(ca.job_id, ca.job_interno_id) as job_id,
  ca.nome_job,
  ca.cargo as cargo_contrato,
  ca.valor,
  ca.tipo,
  ca.data_inicio,
  ca.data_termino,
  ca.cidade as cidade_contrato,
  ca.status_real,
  ca.arquivo_url,
  ca.minuta_url,
  ca.responsavel_id,
  p.nome as responsavel_nome,
  p.email as responsavel_email,
  coalesce(j.codigo, ji.codigo) as job_codigo,
  coalesce(j.nome, ji.nome) as job_nome,
  case
    when ca.id is null then 'sem_contrato'::text
    when ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'::text
    when ca.arquivo_url is null then 'sem_assinado'::text
    when ca.data_inicio is not null and ca.data_inicio > current_date then 'agendado'::text
    when ca.data_termino is not null and ca.data_termino < current_date then 'vencido'::text
    when ca.data_termino is not null and ca.data_termino <= (current_date + interval '30 days') then 'vencendo'::text
    else 'vigente'::text
  end as status_contrato,
  case
    when ca.status_real = false then 'encerrado'::text
    when ca.id is null then 'pendente'::text
    when ca.data_inicio is not null and ca.data_inicio > current_date and ca.arquivo_url is not null then 'agendado'::text
    when ca.data_termino is not null and ca.data_termino < current_date and ca.arquivo_url is not null then 'irregular'::text
    when ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'::text
    when ca.arquivo_url is null then 'sem_assinado'::text
    when ca.data_termino is not null and ca.data_termino <= (current_date + interval '30 days') then 'vencendo'::text
    when ca.data_termino is null or ca.data_termino >= current_date then 'regular'::text
    else 'limbo'::text
  end as status_calculado,
  f.responsavel_id as freela_responsavel_id,
  pf.nome as freela_responsavel_nome,
  pf.email as freela_responsavel_email,
  case
    when ca.job_id is not null then 'producao'
    when ca.job_interno_id is not null then 'interno'
    else null
  end as job_origem
from public.freelancers f
  left join contrato_ativo ca on ca.freelancer_id = f.id
  left join public.profiles p on p.id = ca.responsavel_id
  left join public.profiles pf on pf.id = f.responsavel_id
  left join public.jobs j on j.id = ca.job_id
  left join public.freelancer_jobs_internos ji on ji.id = ca.job_interno_id;

commit;
