-- =============================================================================
-- Decisão 103 — o relatório de rentabilidade separa o save (Tiago, 24/09/2026)
-- =============================================================================
--
-- `vw_job_rentabilidade` (Relatórios › Rentabilidade, frente do Antonio)
-- tinha dois desvios em relação às regras do save:
--
-- 1. SAVE CONTAVA COMO RECEITA DO JOB QUE O GERA. O imposto previsto e o
--    custo já deixavam as linhas em save de fora, mas o faturamento previsto
--    (`jobs.faturamento_previsto`) e o realizado (soma dos envios) incluíam
--    a parte de save — crédito do cliente, não receita. Em 24/09 o JOB-0043
--    (job inteiro em save) aparecia com resultado de R$ 6.959,12 e 100% de
--    rentabilidade. Pela decisão 028 §4, o que sai do job que gera é o
--    faturamento CHEIO da linha (principal + honorários + imposto), e ele
--    migra para o job que consome, na proporção do consumo.
--
--    Agora:
--      faturamento previsto  = faturamento previsto − parte de save
--                              + receita migrada dos saves que o job consome
--      faturamento realizado = soma dos envios − parte de save dos envios
--                              + receita migrada já enviada na origem
--    A receita migrada é a MESMA conta do fluxo de caixa (20260827010006):
--    consumo ÷ principal em save da origem × faturamento de save da origem.
--    No realizado, ela vale na proporção do save que a origem já enviou ao
--    faturamento — só migra dinheiro que existe. O imposto realizado segue a
--    fórmula de sempre, sobre o faturamento realizado já ajustado.
--
-- 2. PEDIDO QUE AGUARDA JÁ CONTAVA. O relatório lia as linhas cruas
--    (`jobs_itens_orcado`): enquanto um "gerar save" aguardava o financeiro,
--    o imposto e o custo da linha já saíam. Passa a ler as linhas como o
--    financeiro vê (`vw_itens_orcado_financeiro`, decisão 099 §3), como já
--    fazem o faturamento e o fluxo de caixa. É a troca feita e desfeita em
--    22/09 (20260922140002/140005), agora decidida pelo Tiago.
--
-- Sem save, os números são os de antes (conferido em 24/09 em todos os jobs
-- sem save: nenhuma diferença). Colunas, nomes e tipos iguais.
-- =============================================================================

create or replace view public.vw_job_rentabilidade
with (security_invoker = true) as
with save_gerado as (
  -- Principal em save aprovado de cada job de origem.
  select o.job_id, sum(o.total_orcado) as principal
    from public.vw_itens_orcado_financeiro o
   where o.em_save
   group by o.job_id
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
         coalesce(bv.total, 0) as bv_realizado
    from public.jobs j
    join public.projetos p on p.id = j.projeto_id
    join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
    left join migrado mg on mg.job_consumidor = j.id
    left join save_enviado se on se.job_id = j.id
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
       b.bv_realizado::numeric as bv_realizado
  from base b;

comment on view public.vw_job_rentabilidade is
  'Relatório de rentabilidade por job. Decisão 103 (24/09/2026): o save sai do faturamento do job que o gera e entra no do job que o consome (conta do fluxo de caixa, decisão 028 §4); as linhas são lidas como o financeiro vê (decisão 099).';
