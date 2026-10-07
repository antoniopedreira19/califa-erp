-- Decisão 149 (06/10/2026): o envio para abertura muda pelo tipo de job.
--
-- No Fee e no Always On (categoria de modelo `mensal`, decisão 078) o GP
-- passa a informar UMA data prevista de recebimento POR MÊS do trimestre,
-- em vez da data única. O financeiro recebe essas datas já preenchidas nas
-- parcelas de recebimento da abertura (Tiago, 06/10/2026: "as informações
-- nesse formulário estão aqui para serem enviadas ao financeiro").
--
-- Por que uma coluna no job, e não linhas em `jobs_previsao_recebimento`:
-- aquela tabela é a previsão do FINANCEIRO, gravada na abertura e lida pelo
-- fluxo de caixa. Escrever nela no envio poria no caixa um job que o
-- financeiro ainda não abriu (decisão 113). Esta coluna é o que a produção
-- enviou — o par mensal de `data_prevista_faturamento`, que segue existindo
-- e, no mensal, recebe a data do primeiro mês.
--
-- Formato: objeto { "AAAA-MM-01": "AAAA-MM-DD" }, um par por mês com
-- faturamento. Nulo fora do mensal e no mensal sem recebimento (Interno ·
-- Always On). Quem valida meses e datas é a action do envio, que conhece os
-- meses e o faturamento de cada um; o banco só garante que é um objeto.
--
-- Aditiva: coluna nova, anulável, sem backfill. Nenhum job existente muda.

alter table public.jobs
  add column if not exists recebimento_previsto_por_mes jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_recebimento_previsto_por_mes_objeto'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_recebimento_previsto_por_mes_objeto
      check (
        recebimento_previsto_por_mes is null
        or jsonb_typeof(recebimento_previsto_por_mes) = 'object'
      );
  end if;
end $$;

comment on column public.jobs.recebimento_previsto_por_mes is
  'Decisão 149: no modelo mensal (Fee e Always On), a data prevista de recebimento de cada mês informada pela produção no envio para abertura — { "AAAA-MM-01": "AAAA-MM-DD" }. Pré-preenche as parcelas da abertura no financeiro. Nulo fora do mensal.';
