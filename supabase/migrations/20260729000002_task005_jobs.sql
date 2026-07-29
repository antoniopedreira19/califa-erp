-- =====================================================================
-- Task 005 — Jobs (com regionais + trigger cascata de versao aprovada)
--
-- Nova tabela `regionais` (cadastro tenant-wide).
-- Nova tabela `jobs` com FK a projeto/orcamento/versao/responsavel/regional
-- e self-reference `job_pai_id` pra hierarquia principal/sub-job.
-- Trigger cascata_versao_aprovada: quando uma versao vira 'aprovada',
-- as outras versoes do mesmo orcamento viram 'substituida' automaticamente.
-- =====================================================================

-- 1) regionais ----------------------------------------------------------
create table if not exists public.regionais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  nome text not null,
  ativo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regionais_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index if not exists uniq_regional_nome_por_tenant
  on public.regionais(tenant_id, lower(nome));

create index if not exists idx_regionais_tenant on public.regionais(tenant_id);
create index if not exists idx_regionais_ativo on public.regionais(tenant_id, ativo);

drop trigger if exists trg_regionais_updated_at on public.regionais;
create trigger trg_regionais_updated_at
  before update on public.regionais
  for each row execute function public.set_updated_at();

alter table public.regionais enable row level security;

drop policy if exists regionais_select on public.regionais;
create policy regionais_select on public.regionais
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists regionais_insert on public.regionais;
create policy regionais_insert on public.regionais
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists regionais_update on public.regionais;
create policy regionais_update on public.regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.regionais to authenticated;

-- 2) job_status enum ----------------------------------------------------
-- Ordem dos valores importa pra ordenação; aguardando_abertura vem primeiro
-- pra listagem "novos jobs" ficar no topo naturalmente.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum (
      'aguardando_abertura',
      'rejeitado_financeiro',
      'aberto',
      'em_producao',
      'finalizado',
      'cancelado'
    );
  end if;
end$$;

-- 3) jobs ---------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  codigo text not null,

  projeto_id uuid not null references public.projetos(id) on delete restrict,
  orcamento_id uuid not null references public.orcamentos(id) on delete restrict,
  versao_orcamento_aprovada_id uuid not null references public.versoes_orcamento(id) on delete restrict,

  nome text not null,
  produto text,
  regional_id uuid references public.regionais(id) on delete restrict,
  cidade text,
  data_inicio_prevista date,
  data_fim_prevista date,
  responsavel_id uuid not null references public.profiles(id) on delete restrict,
  valor_total numeric(14, 2),

  job_pai_id uuid references public.jobs(id) on delete restrict,

  status public.job_status not null default 'aguardando_abertura',
  motivo_rejeicao text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint jobs_nao_pai_de_si_mesmo check (job_pai_id is null or job_pai_id != id),
  constraint jobs_datas_ordem check (
    data_inicio_prevista is null
    or data_fim_prevista is null
    or data_fim_prevista >= data_inicio_prevista
  )
);

create unique index if not exists uniq_jobs_codigo_por_tenant
  on public.jobs(tenant_id, codigo);

create unique index if not exists uniq_jobs_por_orcamento_ativo
  on public.jobs(tenant_id, orcamento_id)
  where status != 'cancelado';

create unique index if not exists uniq_jobs_principal_por_projeto
  on public.jobs(projeto_id)
  where job_pai_id is null and status != 'cancelado';

create index if not exists idx_jobs_tenant on public.jobs(tenant_id);
create index if not exists idx_jobs_projeto on public.jobs(projeto_id);
create index if not exists idx_jobs_orcamento on public.jobs(orcamento_id);
create index if not exists idx_jobs_versao on public.jobs(versao_orcamento_aprovada_id);
create index if not exists idx_jobs_responsavel on public.jobs(responsavel_id);
create index if not exists idx_jobs_regional on public.jobs(regional_id);
create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_pai on public.jobs(job_pai_id);
create index if not exists idx_jobs_created_at on public.jobs(created_at desc);

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.jobs to authenticated;

-- 4) trigger cascata: aprovar versao propaga 'substituida' pras outras --
create or replace function public.cascata_versao_aprovada() returns trigger
language plpgsql as $$
begin
  if NEW.status = 'aprovada' and (OLD.status is distinct from 'aprovada') then
    update public.versoes_orcamento
       set status = 'substituida'
     where orcamento_id = NEW.orcamento_id
       and id != NEW.id
       and status not in ('aprovada', 'substituida', 'cancelada');
  end if;
  return NEW;
end$$;

drop trigger if exists trg_cascata_versao_aprovada on public.versoes_orcamento;
create trigger trg_cascata_versao_aprovada
  after update of status on public.versoes_orcamento
  for each row execute function public.cascata_versao_aprovada();
