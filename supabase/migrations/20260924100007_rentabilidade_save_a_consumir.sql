-- =============================================================================
-- Decisão 103 (continuação) — o save a consumir aparece no relatório, e o
-- Relatório de Faturamento volta aos valores cheios (Tiago, 24/09/2026)
-- =============================================================================
--
-- A 20260924100004 tirou o save do faturamento do job que o gera e o levou
-- para o job que consome. Duas consequências, as duas tratadas aqui:
--
-- 1. SAVE QUE NINGUÉM CONSUMIU SUMIA DO RELATÓRIO. O dinheiro existe (o
--    fluxo de caixa já o mostra como "saldo em save de JOB-XXXX"), mas não
--    era de job nenhum e o total do relatório ficava menor que o faturado.
--    O Tiago pediu uma linha "Save a consumir" por job de origem. Duas
--    colunas novas, por job:
--      save_a_consumir_previsto  = faturamento de save × (1 − consumido ÷ principal)
--      save_a_consumir_realizado = parte de save já enviada × (1 − consumido ÷ principal)
--    Somadas à receita migrada dos consumidores, fecham com o faturamento
--    de save de cada origem: o total do relatório volta a ser o faturado.
--
-- 2. O RELATÓRIO DE FATURAMENTO LÊ A MESMA VIEW. `/relatorios/faturamento`
--    usa `faturamento_previsto` e `faturamento_realizado` como "valor a
--    faturar" e "valor faturado" — e o save É cobrado na nota. Desde a
--    100004 ele mostrava o valor sem o save (JOB-0043: R$ 0,00 a faturar,
--    com nota de R$ 6.959,12). Duas colunas novas com os valores cheios, os
--    mesmos de antes da 100004, para ele voltar a ler:
--      faturamento_previsto_bruto  = jobs.faturamento_previsto
--      faturamento_realizado_bruto = soma dos envios ao faturamento
--
-- As 15 colunas de antes ficam iguais; as 4 novas entram no fim.
-- Nenhum dado muda nesta migration.
-- =============================================================================

create or replace view public.vw_job_rentabilidade
with (security_invoker = true) as
with save_gerado as (
  -- Principal em save aprovado de cada job de origem.
  select o.job_id, sum(o.total_orcado) as principal
    from public.vw_itens_orcado_financeiro o
   where o.em_save
   group by o.job_id
), save_consumido as (
  -- Principal de save de cada job de origem já consumido por outros jobs
  -- (como o financeiro vê: consumo que aguarda aprovação ainda não conta).
  select c.job_origem_id as job_id, sum(c.valor) as consumido
    from public.vw_saves_consumos_financeiro c
   where c.job_item_orcado_id is not null
   group by c.job_origem_id
), save_enviado as (
  -- Quanto da parte de save de cada job já foi enviado ao faturamento.
  -- Mensal: o `valor_save` do mês; envio único: a parte de save do job,
  -- limitada ao valor enviado (a mesma conta de vw_faturamento_pendente).
  select e.job_id,
         sum(case
               when e.mes is not null then coalesce(e.valor_save, 0)
               else least(e.valor_faturado, coalesce(j.faturamento_save_previsto, 0))
             end) as valor
    from public.jobs_envio_faturamento e
    join public.jobs j on j.id = e.job_id
   group by e.job_id
), migrado as (
  -- Receita que migra para o job que consome (decisão 028 §4).
  select oc.job_id as job_consumidor,
         sum(c.valor / nullif(g.principal, 0)
             * coalesce(jo.faturamento_save_previsto, 0)) as previsto,
         sum(c.valor / nullif(g.principal, 0)
             * coalesce(jo.faturamento_save_previsto, 0)
             * least(1::numeric,
                     coalesce(se.valor, 0) / nullif(jo.faturamento_save_previsto, 0))) as realizado
    from public.vw_saves_consumos_financeiro c
    join public.jobs_itens_orcado oc on oc.id = c.job_item_orcado_id
    join public.jobs jo on jo.id = c.job_origem_id
    join save_gerado g on g.job_id = c.job_origem_id
    left join save_enviado se on se.job_id = c.job_origem_id
   where c.job_item_orcado_id is not null
   group by oc.job_id
), base as (
  select j.id as job_id,
         j.tenant_id,
         j.empresa_id,
         j.regional_id,
         p.cliente_id,
         p.produto_id as marca_id,
         j.codigo as job_codigo,
         j.nome as job_nome,
         j.data_abertura_financeiro::date as data_abertura_financeiro,
         round(coalesce(j.faturamento_previsto, 0)
               - coalesce(j.faturamento_save_previsto, 0)
               + coalesce(mg.previsto, 0), 2) as faturamento_previsto,
         coalesce(imp_prev.imposto, 0) as imposto_previsto,
         round(coalesce(fr.total, 0)
               - coalesce(se.valor, 0)
               + coalesce(mg.realizado, 0), 2) as faturamento_realizado,
         v.percentual_imposto,
         coalesce(cr.total, 0) as custo_realizado,
         coalesce(bv.total, 0) as bv_realizado,
         -- O save que este job gerou e ninguém consumiu ainda: o faturamento
         -- de save menos a receita que já migrou (decisão 103, 24/09/2026).
         round(greatest(0::numeric,
           coalesce(j.faturamento_save_previsto, 0)
           * (1 - least(1::numeric, coalesce(sc.consumido, 0) / nullif(g.principal, 0)))), 2)
           as save_a_consumir_previsto,
         round(greatest(0::numeric,
           least(coalesce(se.valor, 0), coalesce(j.faturamento_save_previsto, 0))
           * (1 - least(1::numeric, coalesce(sc.consumido, 0) / nullif(g.principal, 0)))), 2)
           as save_a_consumir_realizado,
         -- O que a nota cobra, save incluído — o Relatório de Faturamento
         -- lê estes, e não os de rentabilidade.
         coalesce(j.faturamento_previsto, 0) as faturamento_previsto_bruto,
         coalesce(fr.total, 0) as faturamento_realizado_bruto
    from public.jobs j
    join public.projetos p on p.id = j.projeto_id
    join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
    left join migrado mg on mg.job_consumidor = j.id
    left join save_enviado se on se.job_id = j.id
    left join save_gerado g on g.job_id = j.id
    left join save_consumido sc on sc.job_id = j.id
    left join lateral (
      select case
               when v.percentual_imposto >= 100 then 0::numeric
               else (coalesce(sum(jio.total_orcado) filter (where jio.tipo_custo = any (array['B'::tipo_custo, 'C'::tipo_custo])), 0)
                     + coalesce(sum(jio.total_orcado) filter (where jio.tipo_custo = any (array['A'::tipo_custo, 'AR'::tipo_custo, 'B'::tipo_custo, 'D'::tipo_custo, 'F'::tipo_custo])), 0)
                       * (v.percentual_honorarios / 100.0))
                    * (v.percentual_imposto / 100.0) / (1 - v.percentual_imposto / 100.0)
             end as imposto
        from public.vw_itens_orcado_financeiro jio
       where jio.job_id = j.id
         and coalesce(jio.em_save, false) = false
    ) imp_prev on true
    left join lateral (
      select sum(jobs_envio_faturamento.valor_faturado) as total
        from public.jobs_envio_faturamento
       where jobs_envio_faturamento.job_id = j.id
    ) fr on true
    left join lateral (
      select sum(case
                   when jio.tipo_custo = any (array['A'::tipo_custo, 'D'::tipo_custo]) then coalesce(jio.total_orcado, 0)
                   else coalesce(jir.total_realizado, 0)
                 end) as total
        from public.vw_itens_orcado_financeiro jio
        left join public.jobs_itens_realizado jir
          on jir.job_item_orcado_id = jio.id and jir.job_id = j.id
       where jio.job_id = j.id
         and coalesce(jio.em_save, false) = false
    ) cr on true
    left join lateral (
      select sum(coalesce(ib.valor, 0) - coalesce(ib.valor, 0) * (v.percentual_imposto / 100.0)) as total
        from public.itens_bv ib
        join public.jobs_itens_orcado jio2 on jio2.id = ib.job_item_orcado_id
       where jio2.job_id = j.id
         and ib.situacao = any (array['confirmado'::bv_situacao, 'recebido'::bv_situacao])
    ) bv on true
   where j.data_abertura_financeiro is not null
     and j.status <> all (array['cancelado'::job_status, 'aguardando_abertura'::job_status, 'rejeitado_financeiro'::job_status])
)
select b.job_id,
       b.tenant_id,
       b.empresa_id,
       b.regional_id,
       b.cliente_id,
       b.marca_id,
       b.job_codigo,
       b.job_nome,
       b.data_abertura_financeiro,
       b.faturamento_previsto::numeric as faturamento_previsto,
       b.imposto_previsto::numeric as imposto_previsto,
       b.faturamento_realizado::numeric as faturamento_realizado,
       (case
          when b.faturamento_realizado = 0 then 0::numeric
          when b.percentual_imposto >= 100 then 0::numeric
          else b.faturamento_realizado * (b.percentual_imposto / 100.0) / (1 - b.percentual_imposto / 100.0)
        end)::numeric as imposto_realizado,
       b.custo_realizado::numeric as custo_realizado,
       b.bv_realizado::numeric as bv_realizado,
       b.save_a_consumir_previsto::numeric as save_a_consumir_previsto,
       b.save_a_consumir_realizado::numeric as save_a_consumir_realizado,
       b.faturamento_previsto_bruto::numeric as faturamento_previsto_bruto,
       b.faturamento_realizado_bruto::numeric as faturamento_realizado_bruto
  from base b;


comment on view public.vw_job_rentabilidade is
  'Relatório de rentabilidade por job. Decisão 103 (24/09/2026): o save sai do faturamento do job que o gera e entra no do job que o consome (conta do fluxo de caixa, decisão 028 §4); as linhas são lidas como o financeiro vê (decisão 099); save_a_consumir_* é o save do job ainda não consumido; faturamento_*_bruto são os valores cheios, com o save, para o Relatório de Faturamento.';
