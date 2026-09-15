-- =====================================================================
-- `vw_lancamento_origens` resolve o job do BV, como a vw_fluxo_caixa
--
-- A view que diz de quais jobs vem o dinheiro de uma baixa de título
-- resolvia o job só para item de origem `job`:
--
--     case when fi.origem_tipo = 'job' then fi.origem_id else null end
--
-- É a mesma omissão que a `vw_fluxo_caixa` tinha e que a migration
-- `20260911100001_bv_se_associa_ao_job.sql` corrigiu: o BV TEM job, pelo
-- caminho `itens_bv.job_item_orcado_id` -> `jobs_itens_orcado.job_id`.
--
-- Sem isto, a baixa de um título de BV aparece na Conciliação sem job e
-- — a partir de 15/09/2026, quando a coluna Regional passou a sair das
-- origens — também sem regional. As duas telas voltam a contar a mesma
-- história.
--
-- Só o CTE `comp` muda; colunas, tipos e o resto da view são os mesmos,
-- então `create or replace` preserva os GRANTs.
-- =====================================================================

create or replace view public.vw_lancamento_origens as
 with comp as (
         select fi.faturamento_id,
                case
                    when fi.origem_tipo = 'job'::faturamento_origem then fi.origem_id
                    when fi.origem_tipo = 'bv'::faturamento_origem then bvi.job_id
                    else null::uuid
                end as job_id,
            sum(fi.valor) as valor
           from faturamento_itens fi
             left join itens_bv bv on bv.id = fi.origem_id and fi.origem_tipo = 'bv'::faturamento_origem
             left join jobs_itens_orcado bvi on bvi.id = bv.job_item_orcado_id
          where fi.origem_tipo <> 'save'::faturamento_origem
          group by fi.faturamento_id, (
                case
                    when fi.origem_tipo = 'job'::faturamento_origem then fi.origem_id
                    when fi.origem_tipo = 'bv'::faturamento_origem then bvi.job_id
                    else null::uuid
                end)
        ), tot as (
         select comp.faturamento_id,
            sum(comp.valor) as total
           from comp
          group by comp.faturamento_id
        )
 select l.id as lancamento_id,
    l.tenant_id,
    'job'::text as tipo,
    c.job_id,
    null::uuid as save_job_id,
    (l.valor * (tp.valor_proprio / nullif(tp.valor, 0::numeric)) * (c.valor / nullif(tot.total, 0::numeric)))::numeric(14,2) as valor
   from lancamentos_financeiros l
     join vw_titulo_partes tp on tp.titulo_id = l.titulo_receber_id
     join comp c on c.faturamento_id = tp.faturamento_id
     join tot on tot.faturamento_id = tp.faturamento_id
  where tp.valor_proprio > 0::numeric
union all
 select l.id as lancamento_id,
    l.tenant_id,
    'save'::text as tipo,
    null::uuid as job_id,
    tp.save_job_id,
    (l.valor * (tp.valor_save / nullif(tp.valor, 0::numeric)))::numeric(14,2) as valor
   from lancamentos_financeiros l
     join vw_titulo_partes tp on tp.titulo_id = l.titulo_receber_id
  where tp.valor_save > 0::numeric;

comment on view public.vw_lancamento_origens is
  'De quais jobs vem o dinheiro de uma baixa de título (e quanto veio de save). Resolve o job do BV desde 15/09/2026, como a vw_fluxo_caixa faz desde 11/09. É desta view que a Conciliação tira a coluna Job e, desde 15/09, a Regional.';

grant select on public.vw_lancamento_origens to authenticated;
