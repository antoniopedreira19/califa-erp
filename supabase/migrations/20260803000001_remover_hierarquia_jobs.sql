-- =====================================================================
-- Remover hierarquia job principal/sub-job.
--
-- Origem: spec "2026-08-03-remover-hierarquia-jobs-design.md". A partir
-- desta migration, todo orcamento aprovado vira um job normal, sem
-- distincao de principal/sub. O agrupamento por projeto passa a ser
-- puramente visual na lista /jobs quando ha 2+ jobs.
--
-- Nao migramos dados: sub-jobs existentes viram jobs normais ao dropar
-- a coluna. A regra "1 job ativo por orcamento" continua garantida pelo
-- indice uniq_jobs_por_orcamento_ativo, que permanece.
--
-- Pre-checagem obrigatoria (rodada antes desta migration):
--   select projeto_id, orcamento_id, count(*)
--   from public.jobs
--   where status <> 'cancelado'
--   group by 1, 2
--   having count(*) > 1;
-- Se retornar linhas, cancelar duplicidades antes de aplicar.
-- Executada em 2026-08-03: 0 linhas.
-- =====================================================================

drop index if exists public.uniq_jobs_principal_por_projeto;

alter table public.jobs
  drop constraint if exists jobs_nao_pai_de_si_mesmo;

alter table public.jobs
  drop column if exists job_pai_id;
