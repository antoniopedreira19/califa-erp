-- =====================================================================
-- Backfill: jobs que já existem ganham a cópia do orçado e o faturamento
-- de abertura. Como nenhuma errata existe ainda, a cópia é idêntica à
-- versão aprovada e "faturamento na abertura" = faturamento atual — que
-- é exatamente a verdade histórica desses jobs.
-- =====================================================================

insert into public.jobs_itens_orcado (
  tenant_id, job_id, item_versao_id, grupo_id, ordem, item, tipo_custo,
  categoria_id,
  valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
)
select
  j.tenant_id, j.id, i.id, i.grupo_id, i.ordem, i.item, i.tipo_custo,
  i.categoria_id,
  i.valor_unitario_orcado, i.quantidade_orcada, i.dias_meses_orcado,
  i.valor_unitario_planejado, i.quantidade_planejada, i.dias_meses_planejado
from public.jobs j
join public.versoes_orcamento_itens i
  on i.versao_orcamento_id = j.versao_orcamento_aprovada_id
 and i.tenant_id = j.tenant_id
on conflict (job_id, item_versao_id) do nothing;

-- Faturamento de abertura, pela mesma regra do app: honorários sobre
-- A+B+D; imposto em gross-up sobre B+C+honorários; faturamento é a soma
-- de custos + honorários + imposto.
with agregado as (
  select
    j.id as job_id,
    (v.percentual_honorarios / 100.0) as h,
    least(greatest(v.percentual_imposto / 100.0, 0), 0.9999) as t,
    coalesce(sum(o.total_orcado), 0) as subtotal,
    coalesce(sum(o.total_orcado) filter (where o.tipo_custo in ('A','B','D')), 0) as base_hon,
    coalesce(sum(o.total_orcado) filter (where o.tipo_custo in ('B','C')), 0) as base_bc
  from public.jobs j
  join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
  left join public.jobs_itens_orcado o on o.job_id = j.id
  group by j.id, v.percentual_honorarios, v.percentual_imposto
), calculado as (
  select
    job_id,
    subtotal,
    base_hon * h as honorarios,
    t
  from agregado
), final as (
  select
    c.job_id,
    c.subtotal
      + c.honorarios
      + case when c.t > 0
          then ((a.base_bc + c.honorarios) * c.t) / (1 - c.t)
          else 0 end as faturamento
  from calculado c
  join agregado a on a.job_id = c.job_id
)
update public.jobs j
-- Dinheiro com 2 casas, igual a `jobs.valor_total` — o card de Erratas
-- compara os dois e precisões diferentes viram 1 centavo de divergência.
set faturamento_abertura = round(f.faturamento, 2)
from final f
where f.job_id = j.id
  and j.faturamento_abertura is null;
