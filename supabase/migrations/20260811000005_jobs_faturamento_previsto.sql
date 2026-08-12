-- =====================================================================
-- `jobs.faturamento_previsto` — o que a California emite nota.
--
-- `jobs.valor_total` continua sendo o VALOR DO JOB (compromisso total do
-- cliente, incluindo o que ele paga direto ao fornecedor). O número novo
-- anda ao lado dele para a listagem de jobs mostrar os dois sem precisar
-- reabrir os itens de cada job — recalcular linha a linha numa lista é
-- exatamente o anti-padrão que `docs/PERFORMANCE.md` proíbe.
--
-- Backfill com a mesma conta de `calcularTotaisVersao`
-- (lib/calculos/versao-totais.ts), lendo as taxas da versão aprovada:
--
--   honorários = Σ(A, AR, B, D, F)      × %honor
--   imposto    = (Σ(B, C) + honorários) × t/(1−t)
--   faturamento previsto = Σ(AR, B, C) + honorários + imposto
--
-- Hoje só existem itens A, B e C gravados, mas a expressão já cobre os
-- sete tipos para o backfill não precisar ser refeito.
-- =====================================================================

alter table public.jobs
  add column if not exists faturamento_previsto numeric;

comment on column public.jobs.faturamento_previsto is
  'O que a California emite nota: Σ(AR,B,C) + honorários + imposto. Difere de valor_total pelos principais pagos direto ao fornecedor (A, D, F).';

with fechamento as (
  select
    j.id as job_id,
    coalesce(sum(i.total_orcado) filter (
      where i.tipo_custo in ('A', 'AR', 'B', 'D', 'F')
    ), 0) * coalesce(v.percentual_honorarios, 0) / 100.0 as honorarios,
    coalesce(sum(i.total_orcado) filter (
      where i.tipo_custo in ('B', 'C')
    ), 0) as base_custo_imposto,
    coalesce(sum(i.total_orcado) filter (
      where i.tipo_custo in ('AR', 'B', 'C')
    ), 0) as principal_faturado,
    -- Trava a taxa em [0, 0.9999] como o TypeScript faz: 100% de imposto
    -- faria o gross-up dividir por zero.
    least(greatest(coalesce(v.percentual_imposto, 0) / 100.0, 0), 0.9999) as taxa
  from public.jobs j
  join public.versoes_orcamento v
    on v.id = j.versao_orcamento_aprovada_id
  left join public.jobs_itens_orcado i
    on i.job_id = j.id
  group by j.id, v.percentual_honorarios, v.percentual_imposto
)
update public.jobs j
   set faturamento_previsto = round(
         f.principal_faturado
         + f.honorarios
         + case when f.taxa > 0
                then (f.base_custo_imposto + f.honorarios) * f.taxa / (1 - f.taxa)
                else 0
           end,
         2
       )
  from fechamento f
 where f.job_id = j.id;
