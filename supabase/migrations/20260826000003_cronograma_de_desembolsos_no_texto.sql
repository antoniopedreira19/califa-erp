-- =====================================================================
-- "Curva de desembolso" passa a se chamar "Cronograma de desembolsos"
-- =====================================================================
--
-- Decisão do Tiago, 26/08/2026. A previsão de custo do job aparecia com
-- três nomes diferentes para o usuário:
--
--   • "Previsão de custos" — o <h2> da seção no form de Abertura do Job;
--   • "Curva de desembolso" — o bloco DENTRO dessa seção, e a sub-linha
--     da aba Fluxo de Caixa do Job;
--   • "Curva {codigo} · desembolso {n}/{m}" — o texto que ESTA view
--     monta, que a composição do valor (decisão 027 §5) agora mostra.
--
-- O nome único é **Cronograma de desembolsos**, e ele fica um nível
-- abaixo de "Previsão de custos", que já é o nome da seção que o contém:
--
--   Previsão de custos › Cronograma de desembolsos
--
-- Esta migration troca só o TEXTO do branch 6, e o adota no mesmo
-- formato do branch 7 (recebimento) — rótulo antes do ponto médio,
-- identificação da parcela depois. Assim `repartirDescricao`
-- (`app/(app)/financeiro/jobs/[jobId]/fluxo-do-job.ts`) reparte os dois
-- pela mesma regra:
--
--   antes:  'Curva JOB-0013 · desembolso 1/2'
--   depois: 'Cronograma de desembolsos · JOB-0013 1/2'
--
-- ⚠️ Esta string também é lida pela tela geral `/financeiro/fluxo-caixa`,
-- que passa a mostrar o nome novo. É intencional: é o mesmo conceito, e
-- deixar duas telas chamando a mesma linha por nomes diferentes é o que
-- esta migration existe para acabar.
--
-- Nada mais muda. Os oito branches, as colunas, os filtros e o rateio
-- são idênticos aos da `20260826000001` — só a expressão de `descricao`
-- do branch 6 é outra. A tabela `jobs_previsao_custo` mantém o nome:
-- renomear tabela em uso é destrutivo e não traz nada aqui.
--
-- LADO DESTRUTIVO: NENHUM. `create or replace view`, mesma lista de
-- colunas, nenhuma tabela tocada.
-- =====================================================================

create or replace view public.vw_fluxo_caixa as
  with avulsa_rateio as (
    select r.conta_avulsa_id,
           r.regional_id,
           (r.percentual / 100.0) as fator
      from contas_avulsas_regionais r
    union all
    select a.id,
           coalesce(j.regional_id, e.regional_id) as regional_id,
           1.0 as fator
      from contas_avulsas a
      left join jobs j on j.id = a.job_id
      left join empresas e on e.id = a.empresa_id
     where not exists (
       select 1 from contas_avulsas_regionais r where r.conta_avulsa_id = a.id
     )
  ),
  lancamento_rateio as (
    select l.id as lancamento_id,
           ar.regional_id,
           ar.fator
      from lancamentos_financeiros l
      join avulsa_rateio ar on ar.conta_avulsa_id = l.conta_avulsa_id
    union all
    select l.id,
           coalesce(j.regional_id, e.regional_id) as regional_id,
           1.0 as fator
      from lancamentos_financeiros l
      left join jobs j on j.id = l.job_id
      left join empresas e on e.id = l.empresa_id
     where l.conta_avulsa_id is null
  ),
  fat_composicao as (
    select fi.faturamento_id,
           case when fi.origem_tipo = 'job' then fi.origem_id else null::uuid end as job_id,
           sum(fi.valor) as valor
      from faturamento_itens fi
     group by fi.faturamento_id,
              case when fi.origem_tipo = 'job' then fi.origem_id else null::uuid end
  ),
  fat_total as (
    select fat_composicao.faturamento_id,
           sum(fat_composicao.valor) as total
      from fat_composicao
     group by fat_composicao.faturamento_id
  ),
  lancamento_job as (
    select l.id as lancamento_id,
           coalesce(rat.job_id, l.job_id) as job_id,
           coalesce(rat.fator, 1.0)       as fator
      from lancamentos_financeiros l
      left join lateral (
        select c.job_id,
               (c.valor / nullif(ft.total, 0::numeric)) as fator
          from titulos_receber t
          join fat_composicao c on c.faturamento_id = t.faturamento_id
          join fat_total     ft on ft.faturamento_id = t.faturamento_id
         where t.id = l.titulo_receber_id
           and l.job_id is null
      ) rat on true
  ),
  itens_com_pp as (
    select distinct pc.item_realizado_id
      from pedidos_compra pc
     where pc.status = any (array['aprovada'::pp_status, 'pago'::pp_status])
  ),
  abatimento_curva as (
    select ir.job_id,
           sum(coalesce(voi.total_planejado, 0::numeric))::numeric(14,2) as valor
      from jobs_itens_realizado ir
      join versoes_orcamento_itens voi on voi.id = ir.item_id
     where ir.id in (select item_realizado_id from itens_com_pp)
       and voi.tipo_custo::text = any (array['AR', 'B', 'C', 'F', 'FI'])
     group by ir.job_id
  ),
  curva as (
    select p.id,
           p.tenant_id,
           p.job_id,
           p.ordem,
           p.data_prevista,
           p.valor,
           sum(p.valor) over (
             partition by p.job_id
             order by p.data_prevista, p.ordem, p.id
             rows between unbounded preceding and current row
           ) as acumulado,
           count(*) over (partition by p.job_id) as total_parcelas
      from jobs_previsao_custo p
  ),
  residuo_curva as (
    select c.id,
           c.tenant_id,
           c.job_id,
           c.ordem,
           c.total_parcelas,
           c.data_prevista,
           greatest(0::numeric, least(c.valor, c.acumulado - coalesce(a.valor, 0::numeric)))::numeric(14,2) as valor
      from curva c
      left join abatimento_curva a on a.job_id = c.job_id
  ),
  jobs_com_envio as (
    select distinct e.job_id from jobs_envio_faturamento e
  ),
  previsao_recebimento as (
    select p.id,
           p.tenant_id,
           p.job_id,
           p.ordem,
           p.data_prevista,
           p.valor,
           count(*) over (partition by p.job_id) as total_parcelas
      from jobs_previsao_recebimento p
  ),
  envio_saldo as (
    select pa.id,
           pa.tenant_id,
           pa.job_id,
           pa.ordem,
           pa.data_vencimento,
           (pa.valor - coalesce((
             select sum(fi.valor)
               from faturamento_itens fi
               join faturamentos f on f.id = fi.faturamento_id
              where fi.envio_parcela_id = pa.id
                and f.status <> 'cancelado'
           ), 0::numeric))::numeric(14,2) as valor,
           count(*) over (partition by pa.envio_id) as total_parcelas
      from jobs_envio_faturamento_parcelas pa
  )

  select
    'realizado'::text                               as situacao,
    'lancamento'::text                              as origem_tipo,
    l.id                                            as origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento                                as data_evento,
    (l.valor * lr.fator * lj.fator)::numeric(14,2)  as valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    lj.job_id,
    'movimento'::text                               as classe,
    lr.regional_id,
    l.origem::text                                  as origem_lancamento
  from lancamentos_financeiros l
  join lancamento_rateio lr on lr.lancamento_id = l.id
  join lancamento_job    lj on lj.lancamento_id = l.id

  union all

  select
    'previsto'::text                                as situacao,
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id,
    'titulo'::text                                  as classe,
    jb.regional_id,
    null::text                                      as origem_lancamento
  from pedidos_compra_parcelas par
  join pedidos_compra pp on pp.id = par.pedido_compra_id
  join jobs jb on jb.id = pp.job_id
  join lateral (
    select count(*)::int as total
      from pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    'previsto'::text                                as situacao,
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_evento,
    (a.valor * ar.fator)::numeric(14,2)             as valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    'titulo'::text                                  as classe,
    ar.regional_id,
    null::text                                      as origem_lancamento
  from contas_avulsas a
  join avulsa_rateio ar on ar.conta_avulsa_id = a.id
  where a.status = 'aprovada'

  union all

  select
    'previsto'::text                                as situacao,
    'desembolso'::text                              as origem_tipo,
    par.id                                          as origem_id,
    d.tenant_id,
    d.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'Desembolso ' || d.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(d.descricao, 1, 150)   as descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    'titulo'::text                                  as classe,
    jb.regional_id,
    null::text                                      as origem_lancamento
  from desembolsos_parcelas par
  join desembolsos d on d.id = par.desembolso_id
  left join jobs jb on jb.id = d.job_id
  join lateral (
    select count(*)::int as total
      from desembolsos_parcelas x
     where x.desembolso_id = par.desembolso_id
  ) tot on true
  where d.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    'previsto'::text                                as situacao,
    'titulo'::text                                  as origem_tipo,
    t.id                                            as origem_id,
    t.tenant_id,
    t.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    coalesce(t.data_previsao_recebimento, t.data_vencimento) as data_evento,
    (t.valor * coalesce(c.valor / nullif(ft.total, 0::numeric), 1::numeric))::numeric(14,2) as valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Título NF ' || f.numero_nf || '/' || t.numero_parcela::text as descricao,
    f.fornecedor_id,
    f.cliente_id,
    c.job_id,
    'titulo'::text                                  as classe,
    coalesce(j.regional_id, e.regional_id)          as regional_id,
    null::text                                      as origem_lancamento
  from titulos_receber t
  join faturamentos f on f.id = t.faturamento_id
  left join fat_composicao c on c.faturamento_id = t.faturamento_id
  left join fat_total ft on ft.faturamento_id = t.faturamento_id
  left join jobs j on j.id = c.job_id
  left join empresas e on e.id = t.empresa_id
  where t.status = 'em_aberto'

  union all

  -- ── branch 6: cronograma de desembolsos ───────────────────────────
  -- ÚNICA MUDANÇA DESTA MIGRATION: o texto de `descricao`.
  select
    'previsto'::text                                as situacao,
    'previsao_custo'::text                          as origem_tipo,
    r.id                                            as origem_id,
    r.tenant_id,
    j.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    case when r.data_prevista < current_date
         then fc_proxima_janela_pagamento(current_date)
         else r.data_prevista end                   as data_evento,
    r.valor,
    'saida'::natureza_lancamento                    as natureza,
    'Cronograma de desembolsos · ' || j.codigo || ' ' || r.ordem || '/' || r.total_parcelas as descricao,
    null::uuid                                      as fornecedor_id,
    pj.cliente_id,
    r.job_id,
    'previsao'::text                                as classe,
    j.regional_id,
    null::text                                      as origem_lancamento
  from residuo_curva r
  join jobs j on j.id = r.job_id
  left join projetos pj on pj.id = j.projeto_id
  where r.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])

  union all

  select
    'previsto'::text                                as situacao,
    'previsao_recebimento'::text                    as origem_tipo,
    p.id                                            as origem_id,
    p.tenant_id,
    j.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    case when p.data_prevista < current_date
         then current_date + 1
         else p.data_prevista end                   as data_evento,
    p.valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Previsão de recebimento · ' || j.codigo || ' ' || p.ordem || '/' || p.total_parcelas as descricao,
    null::uuid                                      as fornecedor_id,
    pj.cliente_id,
    p.job_id,
    'previsao'::text                                as classe,
    j.regional_id,
    null::text                                      as origem_lancamento
  from previsao_recebimento p
  join jobs j on j.id = p.job_id
  left join projetos pj on pj.id = j.projeto_id
  where p.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])
    and not exists (select 1 from jobs_com_envio ce where ce.job_id = p.job_id)

  union all

  select
    'previsto'::text                                as situacao,
    'envio_parcela'::text                           as origem_tipo,
    s.id                                            as origem_id,
    s.tenant_id,
    j.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    case when s.data_vencimento < current_date
         then current_date + 1
         else s.data_vencimento end                 as data_evento,
    s.valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Faturamento previsto · ' || j.codigo || ' parcela ' || s.ordem || '/' || s.total_parcelas as descricao,
    null::uuid                                      as fornecedor_id,
    pj.cliente_id,
    s.job_id,
    'previsao'::text                                as classe,
    j.regional_id,
    null::text                                      as origem_lancamento
  from envio_saldo s
  join jobs j on j.id = s.job_id
  left join projetos pj on pj.id = j.projeto_id
  where s.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status]);

comment on view public.vw_fluxo_caixa is
  'Fluxo de caixa em três classes (movimento, titulo, previsao). Desde '
  '26/08/2026: só PP aprovada abate o cronograma de desembolsos, o '
  'lançamento de baixa/estorno de título é rateado por job pela '
  'composição da nota (as RPCs de recebimento não gravam job_id), e a '
  'coluna origem_lancamento traz lancamentos_financeiros.origem para a '
  'tela distinguir baixa de estorno na composição do valor.';
