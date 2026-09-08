-- =====================================================================
-- Serviço no job e rateio de competência (decisão 055)
--
-- Design: `Abertura de Job - Servico e Rateio de Competencia.dc.html`.
-- Pedido do Tiago em 07/09/2026.
--
-- 1. `jobs.servico_id`
--
--    O Serviço (Always On, Ativação, Fee, Interno — `categorias_dominio`
--    com escopo `projeto`) mora no orçamento desde a decisão 037, e a
--    ficha do job o lê de lá. O formulário de abertura passa a ter o
--    campo, pré-preenchido pelo orçamento de origem e trocável pelo
--    financeiro SEM alterar o orçamento — o mesmo contrato de
--    `jobs.categoria_id`, que já existia. Quem lê o serviço do job passa a
--    ler esta coluna primeiro e cai no orçamento quando ela está vazia
--    (job ainda na fila, ou aberto antes desta migration sem serviço no
--    orçamento).
--
--    ⚠️ Segunda FK de `jobs` para `categorias_dominio`. Todo embed
--    `categoria:categorias_dominio(...)` a partir de `jobs` precisa da
--    dica `!categoria_id` a partir de agora — sem ela o PostgREST derruba
--    a query inteira, em silêncio (memória "FK nova quebra embed").
--
-- 2. `jobs_competencias`
--
--    A competência deixa de ser um valor único: o job passa a ter de 1 a
--    N linhas (trimestre, ano, percentual) que somam 100%. É o rateio do
--    reconhecimento contábil do job entre trimestres — recebimentos e
--    custos do job são divididos entre as competências na proporção
--    gravada aqui.
--
--    Guarda SÓ o percentual (decisão do Tiago, 07/09/2026): receita e
--    custo têm bases diferentes (faturamento previsto e planejado da
--    planilha), e quem consumir o rateio (relatório por trimestre, DRE)
--    aplica o percentual sobre a base que lhe interessa. Guardar valor
--    criaria um segundo total que divergiria do primeiro na primeira
--    errata.
--
--    `jobs.competencia_trimestre` / `competencia_ano` CONTINUAM sendo
--    gravadas, com a PRIMEIRA competência do rateio (a mais antiga). É o
--    que o filtro "Ano", a ficha e o aviso "Fora da competência" leem
--    hoje; nada que existe quebra, e o rateio completo mora aqui.
--
-- Backfill (só preenche o que está vazio — lado aditivo do
-- docs/FLUXO-BANCO.md):
--   * `jobs.servico_id` recebe o serviço do orçamento de origem nos jobs
--     que JÁ passaram pela abertura (25 jobs em 07/09/2026; JOB-0004 fica
--     vazio porque o orçamento dele não tem serviço);
--   * cada job com competência ganha uma linha de 100% em
--     `jobs_competencias` (25 linhas).
-- =====================================================================

-- ---------- 1. Serviço no job ----------
alter table public.jobs
  add column if not exists servico_id uuid
    references public.categorias_dominio(id) on delete restrict;

create index if not exists idx_jobs_servico on public.jobs(servico_id);

comment on column public.jobs.servico_id is
  'Serviço do job (categorias_dominio, escopo ''projeto''). Herdado do orçamento de origem na abertura, onde o financeiro pode trocá-lo sem alterar o orçamento. Vazio enquanto o job está na fila: aí vale orcamentos.servico_id.';

update public.jobs j
   set servico_id = o.servico_id
  from public.orcamentos o
 where o.id = j.orcamento_id
   and j.servico_id is null
   and o.servico_id is not null
   and j.data_abertura_financeiro is not null;

-- ---------- 2. Rateio de competência ----------
create table if not exists public.jobs_competencias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete cascade,
  trimestre smallint not null,
  ano smallint not null,
  -- Fatia do job reconhecida nesta competência. Até duas casas decimais
  -- (33,33 + 33,33 + 33,34). A soma das linhas do job fecha em 100 —
  -- quem confere é a Server Action, com mensagem legível; aqui só o
  -- intervalo de cada linha.
  percentual numeric(5, 2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_jobs_competencias_trimestre check (trimestre between 1 and 4),
  constraint chk_jobs_competencias_ano check (ano between 2000 and 2100),
  constraint chk_jobs_competencias_percentual
    check (percentual > 0 and percentual <= 100),
  -- Um trimestre entra uma vez só no rateio de um job.
  constraint uniq_jobs_competencias_job_trimestre unique (job_id, ano, trimestre)
);

create index if not exists idx_jobs_competencias_job
  on public.jobs_competencias(job_id);
create index if not exists idx_jobs_competencias_tenant
  on public.jobs_competencias(tenant_id);
-- Relatório por trimestre lê pela competência dentro do tenant.
create index if not exists idx_jobs_competencias_competencia
  on public.jobs_competencias(tenant_id, ano, trimestre);

drop trigger if exists trg_jobs_competencias_updated_at
  on public.jobs_competencias;
create trigger trg_jobs_competencias_updated_at
  before update on public.jobs_competencias
  for each row execute function public.set_updated_at();

alter table public.jobs_competencias enable row level security;

drop policy if exists jobs_competencias_select on public.jobs_competencias;
create policy jobs_competencias_select on public.jobs_competencias
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_competencias_insert on public.jobs_competencias;
create policy jobs_competencias_insert on public.jobs_competencias
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_competencias_update on public.jobs_competencias;
create policy jobs_competencias_update on public.jobs_competencias
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- DELETE pela mesma razão das previsões: o rateio é regravado inteiro a
-- cada edição do registro da abertura (apaga e reinsere).
drop policy if exists jobs_competencias_delete on public.jobs_competencias;
create policy jobs_competencias_delete on public.jobs_competencias
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete
  on public.jobs_competencias to authenticated;

comment on table public.jobs_competencias is
  'Rateio da competência contábil do job entre trimestres: de 1 a N linhas (trimestre, ano, percentual) somando 100%. Guarda só o percentual; quem consome aplica sobre a base que lhe interessa. jobs.competencia_trimestre/ano guardam a primeira linha.';
comment on column public.jobs_competencias.percentual is
  'Fatia do reconhecimento do job nesta competência, em %. As linhas do job somam 100 (conferido pela Server Action).';

-- Uma linha de 100% para cada job que já tem competência registrada.
insert into public.jobs_competencias (tenant_id, job_id, trimestre, ano, percentual, created_by)
select j.tenant_id, j.id, j.competencia_trimestre, j.competencia_ano, 100, j.aberto_por
  from public.jobs j
 where j.competencia_trimestre is not null
   and j.competencia_ano is not null
   and not exists (
     select 1 from public.jobs_competencias c where c.job_id = j.id
   );
