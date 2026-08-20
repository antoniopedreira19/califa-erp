-- =====================================================================
-- vw_a_pagar e vw_fluxo_caixa: adicionar 4ª origem "desembolso".
-- Recria as views preservando TODOS os branches existentes.
-- Ver migration 20260817000004 (versão anterior das views).
--
-- NOTA IMPORTANTE: as definições reais das views divergem do brief:
--   • vw_a_pagar   — 2 branches (pp, avulsa/recorrente); sem colunas extras.
--                    Adicionado: branch desembolso.
--   • vw_fluxo_caixa — possui CTEs complexas, colunas "classe" e "regional_id"
--                    e branches adicionais (previsao_custo, previsao_recebimento,
--                    envio_parcela) além dos documentados no brief.
--                    O branch desembolso usa classe='titulo' e faz LEFT JOIN jobs
--                    para regional_id (mesmo padrão do branch pp).
--                    Adicionado: branch desembolso.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- vw_a_pagar
-- ─────────────────────────────────────────────────────────────────────
create or replace view vw_a_pagar as
  -- branch 1: pedidos de compra (pp)
  select
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    par.data_pagamento                              as data_prevista,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id,
    pp.aprovada_em,
    pp.aprovada_por
  from pedidos_compra_parcelas par
  join pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  -- branch 2: contas avulsas / recorrentes
  select
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_prevista,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    a.aprovada_em,
    a.aprovada_por
  from contas_avulsas a
  where a.status = 'aprovada'

  union all

  -- branch 3: desembolsos (parcelas aprovadas ainda não pagas)
  select
    'desembolso'::text                              as origem_tipo,
    par.id                                          as origem_id,
    d.tenant_id,
    d.empresa_id,
    par.data_pagamento                              as data_prevista,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'Desembolso ' || d.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(d.descricao, 1, 150)   as descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    d.aprovada_em,
    d.aprovada_por
  from desembolsos_parcelas par
  join desembolsos d on d.id = par.desembolso_id
  join lateral (
    select count(*)::int as total
      from desembolsos_parcelas x
     where x.desembolso_id = par.desembolso_id
  ) tot on true
  where d.status in ('aprovada', 'pago')
    and par.pago_em is null;


-- ─────────────────────────────────────────────────────────────────────
-- vw_fluxo_caixa
-- Preserva TODAS as CTEs e branches da versão anterior.
-- Adicionado: branch desembolso (entre avulsa/recorrente e titulo).
-- ─────────────────────────────────────────────────────────────────────
create or replace view vw_fluxo_caixa as
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
  itens_com_pp as (
    select distinct pc.item_realizado_id
      from pedidos_compra pc
     where pc.status <> all (array['cancelada'::pp_status, 'rejeitada'::pp_status])
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

  -- ── branch 1: lançamentos realizados ──────────────────────────────
  select
    'realizado'::text                               as situacao,
    'lancamento'::text                              as origem_tipo,
    l.id                                            as origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento                                as data_evento,
    (l.valor * lr.fator)::numeric(14,2)             as valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    l.job_id,
    'movimento'::text                               as classe,
    lr.regional_id
  from lancamentos_financeiros l
  join lancamento_rateio lr on lr.lancamento_id = l.id

  union all

  -- ── branch 2: pedidos de compra (pp) ──────────────────────────────
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
    jb.regional_id
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

  -- ── branch 3: contas avulsas / recorrentes ─────────────────────────
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
    ar.regional_id
  from contas_avulsas a
  join avulsa_rateio ar on ar.conta_avulsa_id = a.id
  where a.status = 'aprovada'

  union all

  -- ── branch 4: desembolsos (parcelas aprovadas ainda não pagas) ─────
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
    jb.regional_id
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

  -- ── branch 5: títulos a receber ────────────────────────────────────
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
    coalesce(j.regional_id, e.regional_id)          as regional_id
  from titulos_receber t
  join faturamentos f on f.id = t.faturamento_id
  left join fat_composicao c on c.faturamento_id = t.faturamento_id
  left join fat_total ft on ft.faturamento_id = t.faturamento_id
  left join jobs j on j.id = c.job_id
  left join empresas e on e.id = t.empresa_id
  where t.status = 'em_aberto'

  union all

  -- ── branch 6: previsão de custo (curva) ───────────────────────────
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
    'Curva ' || j.codigo || ' · desembolso ' || r.ordem || '/' || r.total_parcelas as descricao,
    null::uuid                                      as fornecedor_id,
    pj.cliente_id,
    r.job_id,
    'previsao'::text                                as classe,
    j.regional_id
  from residuo_curva r
  join jobs j on j.id = r.job_id
  left join projetos pj on pj.id = j.projeto_id
  where r.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])

  union all

  -- ── branch 7: previsão de recebimento ────────────────────────────
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
    j.regional_id
  from previsao_recebimento p
  join jobs j on j.id = p.job_id
  left join projetos pj on pj.id = j.projeto_id
  where p.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])
    and not exists (select 1 from jobs_com_envio ce where ce.job_id = p.job_id)

  union all

  -- ── branch 8: envio de faturamento ───────────────────────────────
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
    j.regional_id
  from envio_saldo s
  join jobs j on j.id = s.job_id
  left join projetos pj on pj.id = j.projeto_id
  where s.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status]);
