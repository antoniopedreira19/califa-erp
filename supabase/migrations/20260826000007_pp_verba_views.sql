-- =====================================================================
-- vw_a_pagar e vw_fluxo_caixa ganham devoluções de verba em aberto.
--
-- Estrutura verificada via pg_get_viewdef antes de escrever esta migration:
--
-- vw_a_pagar tinha 3 UNIONs: pp | avulsa/recorrente | desembolso
-- vw_fluxo_caixa tinha 8 UNIONs + CTEs complexas + colunas extras
--   (classe, regional_id, origem_lancamento) que o brief não mostrava.
--
-- Estratégia: manter TODAS as UNIONs existentes sem alterar uma vírgula,
-- apenas acrescentar nova UNION ao final com origem_tipo='pp_devolucao_verba'.
--
-- Devolução aparece com natureza='entrada' (dinheiro voltando à agência)
-- e sem fornecedor/cliente. Realizado já entra pelo ramo de lancamentos
-- existente — nada a acrescentar nessa view.
-- =====================================================================

-- =====================================================================
-- vw_a_pagar
-- =====================================================================
create or replace view public.vw_a_pagar as

  -- 1. Parcelas de PP em aberto
  select
    'pp'::text                                        as origem_tipo,
    par.id                                            as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    par.data_pagamento                                as data_prevista,
    par.valor::numeric(14,2)                          as valor,
    'saida'::natureza_lancamento                      as natureza,
    (((((('PP '::text || pp.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text)
      || substring(pp.servico, 1, 150)                as descricao,
    pp.fornecedor_id,
    null::uuid                                        as cliente_id,
    pp.job_id,
    pp.aprovada_em,
    pp.aprovada_por
  from public.pedidos_compra_parcelas par
  join public.pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from public.pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status = any (array['aprovada'::pp_status, 'pago'::pp_status])
    and par.pago_em is null

  union all

  -- 2. Contas avulsas/recorrentes aprovadas em aberto
  select
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                      as origem_tipo,
    a.id                                              as origem_id,
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
  from public.contas_avulsas a
  where a.status = 'aprovada'::conta_avulsa_status

  union all

  -- 3. Parcelas de desembolso em aberto
  select
    'desembolso'::text                                as origem_tipo,
    par.id                                            as origem_id,
    d.tenant_id,
    d.empresa_id,
    par.data_pagamento                                as data_prevista,
    par.valor,
    'saida'::natureza_lancamento                      as natureza,
    (((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text)
      || substring(d.descricao, 1, 150)               as descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    d.aprovada_em,
    d.aprovada_por
  from public.desembolsos_parcelas par
  join public.desembolsos d on d.id = par.desembolso_id
  join lateral (
    select count(*)::int as total
      from public.desembolsos_parcelas x
     where x.desembolso_id = par.desembolso_id
  ) tot on true
  where d.status = any (array['aprovada'::desembolso_status, 'pago'::desembolso_status])
    and par.pago_em is null

  union all

  -- 4. Devoluções de verba em aberto (natureza=entrada — dinheiro voltando)
  select
    'pp_devolucao_verba'::text                        as origem_tipo,
    d.id                                              as origem_id,
    d.tenant_id,
    d.empresa_id,
    d.data_pagamento                                  as data_prevista,
    d.valor::numeric(14,2)                            as valor,
    'entrada'::natureza_lancamento                    as natureza,
    ('Devolução verba '::text || pp.codigo || ' — '::text)
      || substring(pp.servico, 1, 140)                as descricao,
    null::uuid                                        as fornecedor_id,
    null::uuid                                        as cliente_id,
    pp.job_id,
    null::timestamptz                                 as aprovada_em,
    null::uuid                                        as aprovada_por
  from public.pp_verba_devolucoes d
  join public.pedidos_compra pp on pp.id = d.pedido_compra_id
  where d.pago_em is null;

-- =====================================================================
-- vw_fluxo_caixa
-- Reproduz as CTEs e todos os UNIONs existentes integralmente,
-- acrescentando o UNION de devolução de verba antes do encerramento.
-- Colunas extras presentes na view real: classe, regional_id, origem_lancamento.
-- =====================================================================
create or replace view public.vw_fluxo_caixa as

with avulsa_rateio as (
  select r.conta_avulsa_id,
         r.regional_id,
         r.percentual / 100.0 as fator
    from public.contas_avulsas_regionais r
  union all
  select a.id,
         coalesce(j.regional_id, e.regional_id) as regional_id,
         1.0 as fator
    from public.contas_avulsas a
    left join public.jobs j on j.id = a.job_id
    left join public.empresas e on e.id = a.empresa_id
   where not exists (
     select 1 from public.contas_avulsas_regionais r where r.conta_avulsa_id = a.id
   )
),
lancamento_rateio as (
  select l.id as lancamento_id,
         ar.regional_id,
         ar.fator
    from public.lancamentos_financeiros l
    join avulsa_rateio ar on ar.conta_avulsa_id = l.conta_avulsa_id
  union all
  select l.id,
         coalesce(j.regional_id, e.regional_id) as regional_id,
         1.0 as fator
    from public.lancamentos_financeiros l
    left join public.jobs j on j.id = l.job_id
    left join public.empresas e on e.id = l.empresa_id
   where l.conta_avulsa_id is null
),
fat_composicao as (
  select fi.faturamento_id,
         case when fi.origem_tipo = 'job'::faturamento_origem then fi.origem_id
              else null::uuid end as job_id,
         sum(fi.valor) as valor
    from public.faturamento_itens fi
   group by fi.faturamento_id,
            (case when fi.origem_tipo = 'job'::faturamento_origem then fi.origem_id
                  else null::uuid end)
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
         coalesce(rat.fator, 1.0) as fator
    from public.lancamentos_financeiros l
    left join lateral (
      select c.job_id,
             c.valor / nullif(ft.total, 0::numeric) as fator
        from public.titulos_receber t
        join fat_composicao c on c.faturamento_id = t.faturamento_id
        join fat_total ft on ft.faturamento_id = t.faturamento_id
       where t.id = l.titulo_receber_id and l.job_id is null
    ) rat on true
),
itens_com_pp as (
  select distinct pc.item_realizado_id
    from public.pedidos_compra pc
   where pc.status = any (array['aprovada'::pp_status, 'pago'::pp_status])
),
abatimento_curva as (
  select ir.job_id,
         sum(coalesce(voi.total_planejado, 0::numeric))::numeric(14,2) as valor
    from public.jobs_itens_realizado ir
    join public.versoes_orcamento_itens voi on voi.id = ir.item_id
   where (ir.id in (select itens_com_pp.item_realizado_id from itens_com_pp))
     and (voi.tipo_custo::text = any (array['AR'::text, 'B'::text, 'C'::text, 'F'::text, 'FI'::text]))
   group by ir.job_id
),
curva as (
  select p.id,
         p.tenant_id,
         p.job_id,
         p.ordem,
         p.data_prevista,
         p.valor,
         sum(p.valor) over (partition by p.job_id order by p.data_prevista, p.ordem, p.id
                            rows between unbounded preceding and current row) as acumulado,
         count(*) over (partition by p.job_id) as total_parcelas
    from public.jobs_previsao_custo p
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
  select distinct e.job_id
    from public.jobs_envio_faturamento e
),
previsao_recebimento as (
  select p.id,
         p.tenant_id,
         p.job_id,
         p.ordem,
         p.data_prevista,
         p.valor,
         count(*) over (partition by p.job_id) as total_parcelas
    from public.jobs_previsao_recebimento p
),
envio_saldo as (
  select pa.id,
         pa.tenant_id,
         pa.job_id,
         pa.ordem,
         pa.data_vencimento,
         (pa.valor - coalesce((
           select sum(fi.valor)
             from public.faturamento_itens fi
             join public.faturamentos f on f.id = fi.faturamento_id
            where fi.envio_parcela_id = pa.id
              and f.status <> 'cancelado'::faturamento_status
         ), 0::numeric))::numeric(14,2) as valor,
         count(*) over (partition by pa.envio_id) as total_parcelas
    from public.jobs_envio_faturamento_parcelas pa
)

-- 1. Realizado: lançamentos financeiros
select 'realizado'::text                              as situacao,
       'lancamento'::text                             as origem_tipo,
       l.id                                           as origem_id,
       l.tenant_id,
       l.empresa_id,
       l.conta_bancaria_id,
       l.data_movimento                               as data_evento,
       (l.valor * lr.fator * lj.fator)::numeric(14,2) as valor,
       l.natureza,
       l.descricao,
       l.fornecedor_id,
       l.cliente_id,
       lj.job_id,
       'movimento'::text                              as classe,
       lr.regional_id,
       l.origem::text                                 as origem_lancamento
  from public.lancamentos_financeiros l
  join lancamento_rateio lr on lr.lancamento_id = l.id
  join lancamento_job lj on lj.lancamento_id = l.id

union all

-- 2. Previsto: parcelas de PP em aberto
select 'previsto'::text                               as situacao,
       'pp'::text                                     as origem_tipo,
       par.id                                         as origem_id,
       pp.tenant_id,
       pp.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       par.data_pagamento                             as data_evento,
       par.valor::numeric(14,2)                       as valor,
       'saida'::natureza_lancamento                   as natureza,
       (((((('PP '::text || pp.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text)
         || substring(pp.servico, 1, 150)             as descricao,
       pp.fornecedor_id,
       null::uuid                                     as cliente_id,
       pp.job_id,
       'titulo'::text                                 as classe,
       jb.regional_id,
       null::text                                     as origem_lancamento
  from public.pedidos_compra_parcelas par
  join public.pedidos_compra pp on pp.id = par.pedido_compra_id
  join public.jobs jb on jb.id = pp.job_id
  join lateral (
    select count(*)::int as total
      from public.pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
 where pp.status = any (array['aprovada'::pp_status, 'pago'::pp_status])
   and par.pago_em is null

union all

-- 3. Previsto: contas avulsas/recorrentes aprovadas
select 'previsto'::text                               as situacao,
       case when a.recorrente_id is not null then 'recorrente'::text
            else 'avulsa'::text end                   as origem_tipo,
       a.id                                           as origem_id,
       a.tenant_id,
       a.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_evento,
       (a.valor * ar.fator)::numeric(14,2)            as valor,
       a.natureza,
       a.descricao,
       a.fornecedor_id,
       a.cliente_id,
       a.job_id,
       'titulo'::text                                 as classe,
       ar.regional_id,
       null::text                                     as origem_lancamento
  from public.contas_avulsas a
  join avulsa_rateio ar on ar.conta_avulsa_id = a.id
 where a.status = 'aprovada'::conta_avulsa_status

union all

-- 4. Previsto: parcelas de desembolso em aberto
select 'previsto'::text                               as situacao,
       'desembolso'::text                             as origem_tipo,
       par.id                                         as origem_id,
       d.tenant_id,
       d.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       par.data_pagamento                             as data_evento,
       par.valor,
       'saida'::natureza_lancamento                   as natureza,
       (((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text)
         || substring(d.descricao, 1, 150)            as descricao,
       d.fornecedor_id,
       d.cliente_id,
       d.job_id,
       'titulo'::text                                 as classe,
       jb.regional_id,
       null::text                                     as origem_lancamento
  from public.desembolsos_parcelas par
  join public.desembolsos d on d.id = par.desembolso_id
  left join public.jobs jb on jb.id = d.job_id
  join lateral (
    select count(*)::int as total
      from public.desembolsos_parcelas x
     where x.desembolso_id = par.desembolso_id
  ) tot on true
 where d.status = any (array['aprovada'::desembolso_status, 'pago'::desembolso_status])
   and par.pago_em is null

union all

-- 5. Previsto: títulos a receber em aberto
select 'previsto'::text                               as situacao,
       'titulo'::text                                 as origem_tipo,
       t.id                                           as origem_id,
       t.tenant_id,
       t.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       coalesce(t.data_previsao_recebimento, t.data_vencimento) as data_evento,
       (t.valor * coalesce(c.valor / nullif(ft.total, 0::numeric), 1::numeric))::numeric(14,2) as valor,
       'entrada'::natureza_lancamento                 as natureza,
       (('Título NF '::text || f.numero_nf) || '/'::text) || t.numero_parcela::text as descricao,
       f.fornecedor_id,
       f.cliente_id,
       c.job_id,
       'titulo'::text                                 as classe,
       coalesce(j.regional_id, e.regional_id)        as regional_id,
       null::text                                     as origem_lancamento
  from public.titulos_receber t
  join public.faturamentos f on f.id = t.faturamento_id
  left join fat_composicao c on c.faturamento_id = t.faturamento_id
  left join fat_total ft on ft.faturamento_id = t.faturamento_id
  left join public.jobs j on j.id = c.job_id
  left join public.empresas e on e.id = t.empresa_id
 where t.status = 'em_aberto'::titulo_receber_status

union all

-- 6. Previsto: resíduo do cronograma de custo (curva) do job
select 'previsto'::text                               as situacao,
       'previsao_custo'::text                         as origem_tipo,
       r.id                                           as origem_id,
       r.tenant_id,
       j.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       case when r.data_prevista < current_date then fc_proxima_janela_pagamento(current_date)
            else r.data_prevista end                  as data_evento,
       r.valor,
       'saida'::natureza_lancamento                   as natureza,
       (((('Cronograma de desembolsos · '::text || j.codigo) || ' '::text) || r.ordem) || '/'::text)
         || r.total_parcelas                          as descricao,
       null::uuid                                     as fornecedor_id,
       pj.cliente_id,
       r.job_id,
       'previsao'::text                               as classe,
       j.regional_id,
       null::text                                     as origem_lancamento
  from residuo_curva r
  join public.jobs j on j.id = r.job_id
  left join public.projetos pj on pj.id = j.projeto_id
 where r.valor > 0::numeric
   and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])

union all

-- 7. Previsto: previsão de recebimento de job (sem envio de faturamento)
select 'previsto'::text                               as situacao,
       'previsao_recebimento'::text                   as origem_tipo,
       p.id                                           as origem_id,
       p.tenant_id,
       j.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       case when p.data_prevista < current_date then current_date + 1
            else p.data_prevista end                  as data_evento,
       p.valor,
       'entrada'::natureza_lancamento                 as natureza,
       (((('Previsão de recebimento · '::text || j.codigo) || ' '::text) || p.ordem) || '/'::text)
         || p.total_parcelas                          as descricao,
       null::uuid                                     as fornecedor_id,
       pj.cliente_id,
       p.job_id,
       'previsao'::text                               as classe,
       j.regional_id,
       null::text                                     as origem_lancamento
  from previsao_recebimento p
  join public.jobs j on j.id = p.job_id
  left join public.projetos pj on pj.id = j.projeto_id
 where p.valor > 0::numeric
   and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])
   and not exists (select 1 from jobs_com_envio ce where ce.job_id = p.job_id)

union all

-- 8. Previsto: saldo de envio de faturamento a ser faturado
select 'previsto'::text                               as situacao,
       'envio_parcela'::text                          as origem_tipo,
       s.id                                           as origem_id,
       s.tenant_id,
       j.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       case when s.data_vencimento < current_date then current_date + 1
            else s.data_vencimento end                as data_evento,
       s.valor,
       'entrada'::natureza_lancamento                 as natureza,
       (((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text)
         || s.total_parcelas                          as descricao,
       null::uuid                                     as fornecedor_id,
       pj.cliente_id,
       s.job_id,
       'previsao'::text                               as classe,
       j.regional_id,
       null::text                                     as origem_lancamento
  from envio_saldo s
  join public.jobs j on j.id = s.job_id
  left join public.projetos pj on pj.id = j.projeto_id
 where s.valor > 0::numeric
   and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])

union all

-- 9. Previsto: devoluções de verba em aberto (natureza=entrada — dinheiro voltando)
select 'previsto'::text                               as situacao,
       'pp_devolucao_verba'::text                     as origem_tipo,
       d.id                                           as origem_id,
       d.tenant_id,
       d.empresa_id,
       null::uuid                                     as conta_bancaria_id,
       d.data_pagamento                               as data_evento,
       d.valor::numeric(14,2)                         as valor,
       'entrada'::natureza_lancamento                 as natureza,
       ('Devolução verba '::text || pp.codigo || ' — '::text)
         || substring(pp.servico, 1, 140)             as descricao,
       null::uuid                                     as fornecedor_id,
       null::uuid                                     as cliente_id,
       pp.job_id,
       'titulo'::text                                 as classe,
       jb.regional_id,
       null::text                                     as origem_lancamento
  from public.pp_verba_devolucoes d
  join public.pedidos_compra pp on pp.id = d.pedido_compra_id
  left join public.jobs jb on jb.id = pp.job_id
 where d.pago_em is null;
