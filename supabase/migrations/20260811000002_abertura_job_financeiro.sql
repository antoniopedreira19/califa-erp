-- =====================================================================
-- Abertura de Job no financeiro
--
-- O job nasce na produção (status `aguardando_abertura`) e só passa a
-- existir para o financeiro depois que alguém do financeiro confere os
-- dados da produção e completa o registro contábil. Até hoje essa
-- aprovação era um botão que só mudava o status — sem registro nenhum.
-- Esta migration cria o que o registro precisa:
--
--   * nome_financeiro — o financeiro renomeia o job para o uso dele SEM
--     renomear o job da produção. São dois nomes convivendo de
--     propósito: sobrescrever `nome` renomearia o job do GP sem aviso e
--     sumiria com o termo pelo qual ele acha o job no dia a dia.
--   * categoria_id — classificação contábil do job. Escopo 'job' em
--     `categorias_dominio`, mesmo padrão de projeto e orçamento.
--   * competencia_trimestre / competencia_ano — competência contábil.
--     Sugerida pelo início do job, confirmada por quem abre.
--   * custo_previsto_total — CÓPIA do custo planejado da planilha
--     interna no instante da abertura. É cópia, e não soma calculada em
--     tempo real, porque errata posterior muda o planejado e a previsão
--     de caixa não pode ser reescrita retroativamente.
--   * data_abertura_financeiro / aberto_por — carimbo de quem abriu e
--     quando. Não é editável pela UI.
--
-- E cria `jobs_previsao_custo`: a curva de desembolso, ou seja em que
-- datas o custo previsto deve sair do caixa. Alimenta o fluxo de caixa
-- do financeiro e o comparativo com o planejado da planilha. NÃO trava
-- o realizado — PP e baixa seguem independentes dela.
--
-- Fora desta migration de propósito: marcação de faturamento
-- ("Faturado" / "Aguardando faturamento") e status de encerramento.
-- Ambos aparecem no design da tela, mas não têm dado por trás ainda e
-- entram junto com contas a receber.
-- =====================================================================

-- ---------- 1. Escopo 'job' em categorias_dominio ----------
-- ADD VALUE fica sozinho aqui de propósito: valor novo de enum não pode
-- ser USADO na mesma transação em que é criado. O seed das categorias
-- vem na migration seguinte.
alter type public.categoria_dominio_escopo add value if not exists 'job';

-- ---------- 2. Registro financeiro no job ----------
alter table public.jobs
  add column if not exists nome_financeiro text,
  add column if not exists categoria_id uuid
    references public.categorias_dominio(id) on delete restrict,
  add column if not exists competencia_trimestre smallint,
  add column if not exists competencia_ano smallint,
  add column if not exists custo_previsto_total numeric(14, 2),
  add column if not exists data_abertura_financeiro timestamptz,
  add column if not exists aberto_por uuid
    references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_jobs_nome_financeiro_tamanho'
  ) then
    alter table public.jobs
      add constraint chk_jobs_nome_financeiro_tamanho
      check (
        nome_financeiro is null
        or (length(trim(nome_financeiro)) between 2 and 200)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_jobs_competencia_trimestre'
  ) then
    alter table public.jobs
      add constraint chk_jobs_competencia_trimestre
      check (competencia_trimestre is null or competencia_trimestre between 1 and 4);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_jobs_competencia_ano'
  ) then
    alter table public.jobs
      add constraint chk_jobs_competencia_ano
      check (competencia_ano is null or competencia_ano between 2000 and 2100);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_jobs_custo_previsto_nao_negativo'
  ) then
    alter table public.jobs
      add constraint chk_jobs_custo_previsto_nao_negativo
      check (custo_previsto_total is null or custo_previsto_total >= 0);
  end if;
end$$;

-- FK usada em toda listagem do financeiro que filtra/agrupa por
-- categoria — índice explícito, conforme regra do projeto.
create index if not exists idx_jobs_categoria on public.jobs(categoria_id);

-- A fila de abertura é lida a cada carga da tela do financeiro.
create index if not exists idx_jobs_status_tenant on public.jobs(tenant_id, status);

-- Competência é o eixo dos relatórios contábeis do financeiro.
create index if not exists idx_jobs_competencia
  on public.jobs(tenant_id, competencia_ano, competencia_trimestre);

comment on column public.jobs.nome_financeiro is
  'Nome do job no financeiro. Quando nulo, vale `nome` (o da produção). Nunca sobrescreve `nome`.';
comment on column public.jobs.custo_previsto_total is
  'Cópia do custo planejado da planilha interna no instante da abertura. Errata posterior NÃO reescreve este valor.';

-- ---------- 3. Curva de desembolso ----------
create table if not exists public.jobs_previsao_custo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Posição da parcela na curva (01, 02, 03...). A ação regrava a curva
  -- inteira a cada edição, então a ordem nunca fica com buraco.
  ordem smallint not null,
  data_prevista date not null,
  valor numeric(14, 2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- >= 0 e não > 0: a Server Action é quem recusa parcela zerada, com
  -- mensagem. No banco, zero é dado esquisito, não dado corrompido —
  -- travar aqui devolveria erro de constraint em vez de erro legível.
  constraint chk_previsao_custo_valor_nao_negativo check (valor >= 0),
  constraint uniq_previsao_custo_job_ordem unique (job_id, ordem)
);

create index if not exists idx_previsao_custo_job on public.jobs_previsao_custo(job_id);
create index if not exists idx_previsao_custo_tenant on public.jobs_previsao_custo(tenant_id);
-- Fluxo de caixa lê por janela de data dentro do tenant.
create index if not exists idx_previsao_custo_data
  on public.jobs_previsao_custo(tenant_id, data_prevista);

drop trigger if exists trg_jobs_previsao_custo_updated_at on public.jobs_previsao_custo;
create trigger trg_jobs_previsao_custo_updated_at
  before update on public.jobs_previsao_custo
  for each row execute function public.set_updated_at();

alter table public.jobs_previsao_custo enable row level security;

drop policy if exists jobs_previsao_custo_select on public.jobs_previsao_custo;
create policy jobs_previsao_custo_select on public.jobs_previsao_custo
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_previsao_custo_insert on public.jobs_previsao_custo;
create policy jobs_previsao_custo_insert on public.jobs_previsao_custo
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_previsao_custo_update on public.jobs_previsao_custo;
create policy jobs_previsao_custo_update on public.jobs_previsao_custo
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- DELETE existe porque a curva é regravada inteira a cada edição
-- (apaga e reinsere), e porque rejeição posterior precisa limpá-la.
drop policy if exists jobs_previsao_custo_delete on public.jobs_previsao_custo;
create policy jobs_previsao_custo_delete on public.jobs_previsao_custo
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.jobs_previsao_custo to authenticated;

comment on table public.jobs_previsao_custo is
  'Curva de desembolso do job: em que datas o custo previsto sai do caixa. Alimenta o fluxo de caixa; não trava o realizado.';
