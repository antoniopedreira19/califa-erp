-- =====================================================================
-- Previsão de desembolso passa a valer só para a calha PP
-- (docs/decisions/004, decidida com o financeiro em 12/08/2026)
--
-- Duas correções de dados no mesmo tema:
--
-- 1) `jobs.custo_previsto_total` era a soma do planejado de TODOS os
--    itens. Itens de calha BV (tipos A e D) são pagos pelo cliente
--    direto ao fornecedor — esse dinheiro nunca sai do caixa da
--    California e não pode alimentar previsão de desembolso. Recalcula
--    os jobs já abertos com a regra nova (só AR, B, C, F, FI) e apaga a
--    curva dos que ficarem com custo zero: ela prometia desembolso que
--    não existe.
--
-- 2) `jobs.faturamento_previsto` não era gravado no INSERT do envio do
--    job — só `faturamento_previsto_abertura`. O backfill original
--    (20260811000005) cobriu os jobs daquela data; qualquer job criado
--    entre ela e a correção do INSERT (mesmo commit desta migration)
--    nasceu nulo. Recalcula os nulos com a mesma fórmula, que é
--    determinística sobre os itens e as taxas da versão aprovada.
-- =====================================================================

-- ---------- 1. Custo previsto: só calha PP ----------
with desembolso as (
  select
    j.id as job_id,
    coalesce(sum(i.total_planejado) filter (
      where i.tipo_custo in ('AR', 'B', 'C', 'F', 'FI')
    ), 0) as custo_pp
  from public.jobs j
  left join public.jobs_itens_orcado i
    on i.job_id = j.id
  where j.data_abertura_financeiro is not null
  group by j.id
)
update public.jobs j
   set custo_previsto_total = round(d.custo_pp, 2)
  from desembolso d
 where d.job_id = j.id;

-- Curva órfã: sem desembolso previsto não há datas a prever. (Job com
-- custo > 0 e curva divergente não existe hoje — a regra mudou antes de
-- qualquer job misto ser aberto.)
delete from public.jobs_previsao_custo pc
 using public.jobs j
 where j.id = pc.job_id
   and coalesce(j.custo_previsto_total, 0) = 0;

comment on column public.jobs.custo_previsto_total is
  'Copia, na abertura, do planejado dos itens de calha PP (AR, B, C, F, FI) — so o que a California desembolsa. Itens A e D ficam fora (docs/decisions/004). Zero e legitimo. Errata posterior NAO reescreve.';

-- ---------- 2. faturamento_previsto: backfill dos nulos ----------
-- Mesma fórmula do backfill original (20260811000005), restrita aos
-- jobs que nasceram antes de o INSERT gravar a coluna.
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
    least(greatest(coalesce(v.percentual_imposto, 0) / 100.0, 0), 0.9999) as taxa
  from public.jobs j
  join public.versoes_orcamento v
    on v.id = j.versao_orcamento_aprovada_id
  left join public.jobs_itens_orcado i
    on i.job_id = j.id
  where j.faturamento_previsto is null
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
