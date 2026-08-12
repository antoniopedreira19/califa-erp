-- =====================================================================
-- Erratas passam a registrar os DOIS números do fechamento.
--
-- Uma errata muda o valor orçado e/ou o tipo de custo de um item, e as
-- duas coisas podem mexer em faturamento previsto e valor do job de forma
-- independente: trocar A · Direto por A · Repasse move o faturamento
-- previsto e deixa o valor do job intacto. Guardar só um número apagava
-- metade do efeito no histórico.
--
-- As colunas antigas guardavam o VALOR DO JOB (era o único número que
-- existia). O rename preserva o dado — nada de backfill — e o nome passa a
-- dizer o que ele sempre foi.
--
-- As colunas de faturamento previsto nascem NULL nas erratas anteriores a
-- esta migration: o estado histórico daquele momento não é reconstituível,
-- e inventar número seria pior do que a tela mostrar travessão.
-- =====================================================================

-- ---- jobs_erratas: cabeçalho da errata ----
alter table public.jobs_erratas
  rename column faturamento_antes to valor_job_antes;
alter table public.jobs_erratas
  rename column faturamento_depois to valor_job_depois;

alter table public.jobs_erratas
  add column if not exists faturamento_previsto_antes numeric,
  add column if not exists faturamento_previsto_depois numeric;

comment on column public.jobs_erratas.valor_job_antes is
  'Valor do job (compromisso total do cliente) antes da errata.';
comment on column public.jobs_erratas.faturamento_previsto_antes is
  'O que a California emitiria nota antes da errata. NULL nas erratas anteriores a 11/08/2026.';

-- ---- jobs_erratas_itens: efeito linha a linha ----
alter table public.jobs_erratas_itens
  rename column efeito_faturamento to efeito_valor_job;

alter table public.jobs_erratas_itens
  add column if not exists efeito_faturamento_previsto numeric;

comment on column public.jobs_erratas_itens.efeito_valor_job is
  'Efeito deste item no valor do job. Linear: a soma dos itens fecha com o delta da errata.';
comment on column public.jobs_erratas_itens.efeito_faturamento_previsto is
  'Efeito deste item no faturamento previsto. NULL nas erratas anteriores a 11/08/2026.';

-- ---- jobs: o par na abertura ----
-- `faturamento_abertura` também sempre foi o valor do job.
alter table public.jobs
  rename column faturamento_abertura to valor_job_abertura;

alter table public.jobs
  add column if not exists faturamento_previsto_abertura numeric;

comment on column public.jobs.valor_job_abertura is
  'Valor do job congelado na abertura. O card de Erratas compara o atual contra ele.';
comment on column public.jobs.faturamento_previsto_abertura is
  'Faturamento previsto congelado na abertura.';

-- Backfill só onde é EXATO: job sem errata não mudou desde a abertura,
-- então o faturamento previsto de agora é o da abertura. Job que já sofreu
-- errata fica NULL — o valor de abertura dele não é reconstituível, e a
-- tela mostra travessão em vez de um número inventado.
update public.jobs j
   set faturamento_previsto_abertura = j.faturamento_previsto
 where j.faturamento_previsto is not null
   and not exists (
     select 1 from public.jobs_erratas e where e.job_id = j.id
   );
