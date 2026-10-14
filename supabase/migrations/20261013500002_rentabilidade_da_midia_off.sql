-- =============================================================================
-- Decisão 167 — o job de Mídia Off no relatório de Rentabilidade
-- =============================================================================
--
-- A `vw_job_rentabilidade` (que também alimenta o relatório de Faturamento)
-- fechava o job de Mídia Off pela regra nacional: imposto com gross-up sobre
-- o faturamento e o A · Direto como custo pelo orçado (o negociado). No job
-- de teste TES-1027/26 (só A · Direto, faturamento R$ 840,00), o resultado
-- previsto saía R$ −6.363,87; a abertura e a página do job dão R$ 675,95.
--
-- O Tiago decidiu em 13/10/2026 ("Conta da mídia"), só para o job cujo
-- orçamento é de Mídia Off:
--   - imposto previsto = alíquota × honorários (sai de dentro deles);
--     honorários = % × negociado, ou % × nota do veículo na base "líquido";
--   - imposto realizado = a mesma conta, só nos meses já enviados para
--     faturamento (cada envio é um mês);
--   - custo realizado = as PPs do repasse (linhas A · Repasse). O A · Direto
--     fica fora do custo, como já fica fora do faturamento: o veículo cobra
--     direto do cliente.
-- Em R$, o resultado fica o da abertura.
--
-- Os outros modelos não mudam: o resto da view é a mesma de
-- 20260924100004, como está no banco hoje. Colunas, nomes e tipos iguais.
-- =============================================================================

create or replace view public.vw_job_rentabilidade
with (security_invoker = true) as
with save_gerado as (
  select o.job_id, sum(o.total_orcado) as principal
    from public.vw_itens_orcado_financeiro o
   where o.em_save
   group by o.job_id
), save_consumido as (
  select c.job_origem_id as job_id, sum(c.valor) as consumido
    from public.vw_saves_consumos_financeiro c
   where c.job_item_orcado_id is not null
   group by c.job_origem_id
), save_enviado as (
  select e.job_id,
         sum(
           case
             when e.mes is not null then coalesce(e.valor_save, 0::numeric)
             else least(e.valor_faturado, coalesce(j.faturamento_save_previsto, 0::numeric))
           end) as valor
    from public.jobs_envio_faturamento e
    join public.jobs j on j.id = e.job_id
   group by e.job_id
), migrado as (
  select oc.job_id as job_consumidor,
         sum(c.valor / nullif(g.principal, 0::numeric) * coalesce(jo.faturamento_save_previsto, 0::numeric)) as previsto,
         sum(c.valor / nullif(g.principal, 0::numeric) * coalesce(jo.faturamento_save_previsto, 0::numeric)
             * least(1::numeric, coalesce(se.valor, 0::numeric) / nullif(jo.faturamento_save_previsto, 0::numeric))) as realizado
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
         round(coalesce(j.faturamento_previsto, 0::numeric) - coalesce(j.faturamento_save_previsto, 0::numeric) + coalesce(mg.previsto, 0::numeric), 2) as faturamento_previsto,
         coalesce(imp_prev.imposto, 0::numeric) as imposto_previsto,
         round(coalesce(fr.total, 0::numeric) - coalesce(se.valor, 0::numeric) + coalesce(mg.realizado, 0::numeric), 2) as faturamento_realizado,
         v.percentual_imposto,
         coalesce(cr.total, 0::numeric) as custo_realizado,
         coalesce(bv.total, 0::numeric) as bv_realizado,
         round(greatest(0::numeric, coalesce(j.faturamento_save_previsto, 0::numeric) * (1::numeric - least(1::numeric, coalesce(sc.consumido, 0::numeric) / nullif(g.principal, 0::numeric)))), 2) as save_a_consumir_previsto,
         round(greatest(0::numeric, least(coalesce(se.valor, 0::numeric), coalesce(j.faturamento_save_previsto, 0::numeric)) * (1::numeric - least(1::numeric, coalesce(sc.consumido, 0::numeric) / nullif(g.principal, 0::numeric)))), 2) as save_a_consumir_realizado,
         coalesce(j.faturamento_previsto, 0::numeric) as faturamento_previsto_bruto,
         coalesce(fr.total, 0::numeric) as faturamento_realizado_bruto,
         -- Mídia Off (decisão 167): o imposto realizado vem dos meses enviados.
         (cat.modelo_planilha = 'midia_off') as midia,
         coalesce(imp_real_midia.imposto, 0::numeric) as imposto_realizado_midia
    from public.jobs j
    join public.projetos p on p.id = j.projeto_id
    join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
    left join public.orcamentos orc on orc.id = j.orcamento_id
    left join public.categorias_dominio cat on cat.id = orc.categoria_id
    -- Mídia Off: honorários = % × negociado, ou % × nota do veículo na base
    -- "líquido". Este fator leva o negociado ao imposto: base × honorários
    -- × alíquota.
    cross join lateral (
      select coalesce(case when v.base_honorarios = 'liquido'
                           then coalesce(v.percentual_veiculo, 80::numeric) / 100.0
                           else 1::numeric end, 1::numeric)
             * (v.percentual_honorarios / 100.0)
             * (v.percentual_imposto / 100.0) as fator
    ) imp_midia
    left join migrado mg on mg.job_consumidor = j.id
    left join save_enviado se on se.job_id = j.id
    left join save_gerado g on g.job_id = j.id
    left join save_consumido sc on sc.job_id = j.id
    left join lateral (
      select case
               when cat.modelo_planilha = 'midia_off'
                 then coalesce(sum(jio.total_orcado), 0::numeric) * imp_midia.fator
               when v.percentual_imposto >= 100::numeric then 0::numeric
               else (coalesce(sum(jio.total_orcado) filter (where jio.tipo_custo = any (array['B'::tipo_custo, 'C'::tipo_custo])), 0::numeric)
                     + coalesce(sum(jio.total_orcado) filter (where jio.tipo_custo = any (array['A'::tipo_custo, 'AR'::tipo_custo, 'B'::tipo_custo, 'D'::tipo_custo, 'F'::tipo_custo])), 0::numeric)
                       * (v.percentual_honorarios / 100.0))
                    * (v.percentual_imposto / 100.0) / (1::numeric - v.percentual_imposto / 100.0)
             end as imposto
        from public.vw_itens_orcado_financeiro jio
       where jio.job_id = j.id and coalesce(jio.em_save, false) = false
    ) imp_prev on true
    -- Mídia Off: o imposto dos meses já enviados — o negociado das linhas
    -- de cada mês (o mês do agrupamento da versão) × o fator.
    left join lateral (
      select sum(coalesce(neg.negociado, 0::numeric)) * imp_midia.fator as imposto
        from public.jobs_envio_faturamento e
        cross join lateral (
          select sum(jio.total_orcado) as negociado
            from public.vw_itens_orcado_financeiro jio
            join public.jobs_itens_orcado jc on jc.id = jio.id
            join public.versoes_orcamento_grupos gr on gr.id = jc.grupo_id
            join public.versoes_orcamento_meses m on m.id = gr.mes_id
           where jio.job_id = j.id
             and coalesce(jio.em_save, false) = false
             and m.mes = e.mes
        ) neg
       where e.job_id = j.id
         and e.mes is not null
         and cat.modelo_planilha = 'midia_off'
    ) imp_real_midia on true
    left join lateral (
      select sum(jobs_envio_faturamento.valor_faturado) as total
        from public.jobs_envio_faturamento
       where jobs_envio_faturamento.job_id = j.id
    ) fr on true
    left join lateral (
      select sum(
               case
                 -- Mídia Off: só as PPs do repasse; o A · Direto o veículo
                 -- cobra direto do cliente.
                 when cat.modelo_planilha = 'midia_off' then
                   case when jio.tipo_custo = 'AR'::tipo_custo
                        then coalesce(jir.total_realizado, 0::numeric)
                        else 0::numeric end
                 when jio.tipo_custo = any (array['A'::tipo_custo, 'D'::tipo_custo]) then coalesce(jio.total_orcado, 0::numeric)
                 else coalesce(jir.total_realizado, 0::numeric)
               end) as total
        from public.vw_itens_orcado_financeiro jio
        left join public.jobs_itens_realizado jir on jir.job_item_orcado_id = jio.id and jir.job_id = j.id
       where jio.job_id = j.id and coalesce(jio.em_save, false) = false
    ) cr on true
    left join lateral (
      select sum(coalesce(ib.valor, 0::numeric) - coalesce(ib.valor, 0::numeric) * (v.percentual_imposto / 100.0)) as total
        from public.itens_bv ib
        join public.jobs_itens_orcado jio2 on jio2.id = ib.job_item_orcado_id
       where jio2.job_id = j.id
         and (ib.situacao = any (array['confirmado'::bv_situacao, 'recebido'::bv_situacao]))
    ) bv on true
   where j.data_abertura_financeiro is not null
     and (j.status <> all (array['cancelado'::job_status, 'aguardando_abertura'::job_status, 'rejeitado_financeiro'::job_status]))
)
select job_id,
       tenant_id,
       empresa_id,
       regional_id,
       cliente_id,
       marca_id,
       job_codigo,
       job_nome,
       data_abertura_financeiro,
       faturamento_previsto,
       imposto_previsto,
       faturamento_realizado,
       case
         when midia then imposto_realizado_midia
         when faturamento_realizado = 0::numeric then 0::numeric
         when percentual_imposto >= 100::numeric then 0::numeric
         else faturamento_realizado * (percentual_imposto / 100.0) / (1::numeric - percentual_imposto / 100.0)
       end as imposto_realizado,
       custo_realizado,
       bv_realizado,
       save_a_consumir_previsto,
       save_a_consumir_realizado,
       faturamento_previsto_bruto,
       faturamento_realizado_bruto
  from base b;

comment on view public.vw_job_rentabilidade is
  'Relatório de rentabilidade por job. Decisão 103 (24/09/2026): o save sai do faturamento do job que o gera e entra no do job que o consome (conta do fluxo de caixa, decisão 028 §4); as linhas são lidas como o financeiro vê (decisão 099); save_a_consumir_* é o save do job ainda não consumido; faturamento_*_bruto são os valores cheios, com o save, para o Relatório de Faturamento. Decisão 167 (13/10/2026): no job de Mídia Off, imposto = alíquota × honorários (o realizado, dos meses enviados) e custo = as PPs do repasse; o A · Direto fica fora do custo.';
