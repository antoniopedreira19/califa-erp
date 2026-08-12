-- =====================================================================
-- Views: vw_a_pagar (previsto) e vw_fluxo_caixa (previsto + realizado)
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 1) vw_a_pagar — só PPs aprovadas + avulsas aprovadas
create or replace view public.vw_a_pagar as
select
  'pp'::text                                        as origem_tipo,
  pp.id                                             as origem_id,
  pp.tenant_id,
  pp.empresa_id,
  pp.prazo_pagamento_financeiro                     as data_prevista,
  pp.valor::numeric(14,2)                           as valor,
  'saida'::natureza_lancamento                      as natureza,
  ('PP ' || pp.codigo || ' — ' || substring(pp.servico, 1, 150)) as descricao,
  pp.fornecedor_id,
  null::uuid                                        as cliente_id,
  pp.job_id,
  pp.aprovada_em,
  pp.aprovada_por
from public.pedidos_compra pp
where pp.status = 'aprovada'

union all

select
  case when a.recorrente_id is not null then 'recorrente' else 'avulsa' end,
  a.id,
  a.tenant_id,
  a.empresa_id,
  a.data_prevista_pagamento,
  a.valor::numeric(14,2),
  a.natureza,
  a.descricao,
  a.fornecedor_id,
  a.cliente_id,
  a.job_id,
  a.aprovada_em,
  a.aprovada_por
from public.contas_avulsas a
where a.status = 'aprovada';

grant select on public.vw_a_pagar to authenticated;

-- 2) vw_fluxo_caixa — previsto + realizado
create or replace view public.vw_fluxo_caixa as
select
  'previsto'::text                                  as situacao,
  'pp'::text                                        as origem_tipo,
  pp.id                                             as origem_id,
  pp.tenant_id, pp.empresa_id,
  null::uuid                                        as conta_bancaria_id,
  pp.prazo_pagamento_financeiro                     as data_evento,
  pp.valor::numeric(14,2)                           as valor,
  'saida'::natureza_lancamento                      as natureza,
  ('PP ' || pp.codigo || ' — ' || substring(pp.servico, 1, 150)) as descricao,
  pp.fornecedor_id,
  null::uuid                                        as cliente_id,
  pp.job_id
from public.pedidos_compra pp
where pp.status = 'aprovada'

union all

select
  'previsto',
  case when a.recorrente_id is not null then 'recorrente' else 'avulsa' end,
  a.id,
  a.tenant_id, a.empresa_id,
  null::uuid                                        as conta_bancaria_id,
  a.data_prevista_pagamento,
  a.valor::numeric(14,2),
  a.natureza,
  a.descricao,
  a.fornecedor_id, a.cliente_id, a.job_id
from public.contas_avulsas a
where a.status = 'aprovada'

union all

select
  'realizado',
  'lancamento',
  l.id,
  l.tenant_id, l.empresa_id,
  l.conta_bancaria_id,
  l.data_movimento,
  l.valor,
  l.natureza,
  l.descricao,
  l.fornecedor_id, l.cliente_id, l.job_id
from public.lancamentos_financeiros l;

grant select on public.vw_fluxo_caixa to authenticated;
