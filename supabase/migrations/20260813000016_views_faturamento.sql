-- =====================================================================
-- Views: vw_faturamento_pendente (fila a faturar) e vw_fluxo_caixa
-- estendida com titulos em aberto como previsto de entrada.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) vw_faturamento_pendente — jobs com saldo + BVs confirmados sem faturamento
create or replace view public.vw_faturamento_pendente as
select
  'job'::text                                                as origem_tipo,
  j.id                                                       as origem_id,
  j.tenant_id,
  j.empresa_id,
  j.codigo                                                   as codigo,
  j.nome                                                     as descricao,
  p.cliente_id                                               as cliente_id,
  null::uuid                                                 as fornecedor_id,
  j.faturamento_previsto                                     as valor_previsto,
  coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0)::numeric(14,2)
                                                             as valor_ja_faturado,
  (j.faturamento_previsto
    - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0))::numeric(14,2)
                                                             as saldo,
  j.data_prevista_faturamento                                as data_prevista
from public.jobs j
join public.projetos p on p.id = j.projeto_id
left join public.faturamentos f
  on f.origem_tipo = 'job' and f.origem_id = j.id
where j.status = 'aberto'
  and j.faturamento_previsto is not null
  and j.faturamento_previsto > 0
group by j.id, p.cliente_id
having (j.faturamento_previsto
        - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0)) > 0

union all

-- BVs confirmados sem faturamento ativo
select
  'bv'::text                                                 as origem_tipo,
  bv.id                                                      as origem_id,
  bv.tenant_id,
  null::uuid                                                 as empresa_id,   -- BV nao tem empresa emissora natural
  null::text                                                 as codigo,
  ('BV — ' || v.item)                                        as descricao,
  null::uuid                                                 as cliente_id,
  bv.fornecedor_id,
  bv.valor                                                   as valor_previsto,
  0::numeric(14,2)                                           as valor_ja_faturado,
  bv.valor                                                   as saldo,
  bv.prazo_repasse                                           as data_prevista
from public.itens_bv bv
join public.versoes_orcamento_itens v on v.id = bv.item_versao_id
where bv.situacao = 'confirmado'
  and not exists (
    select 1 from public.faturamentos f
     where f.origem_tipo = 'bv' and f.origem_id = bv.id and f.status = 'emitido'
  );

grant select on public.vw_faturamento_pendente to authenticated;

-- 2) vw_fluxo_caixa — recria com a nova branch de titulos em aberto
create or replace view public.vw_fluxo_caixa as
-- PPs aprovadas ainda não pagas (previsto saida)
select
  'previsto'::text                          as situacao,
  'pp'::text                                as origem_tipo,
  pp.id                                     as origem_id,
  pp.tenant_id, pp.empresa_id,
  null::uuid                                as conta_bancaria_id,
  pp.prazo_pagamento_financeiro             as data_evento,
  pp.valor::numeric(14,2)                   as valor,
  'saida'::natureza_lancamento              as natureza,
  ('PP ' || pp.codigo || ' — ' || substring(pp.servico, 1, 150)) as descricao,
  pp.fornecedor_id,
  null::uuid                                as cliente_id,
  pp.job_id
from public.pedidos_compra pp
where pp.status = 'aprovada'

union all

-- Avulsas aprovadas (previsto saida ou entrada)
select
  'previsto',
  case when a.recorrente_id is not null then 'recorrente' else 'avulsa' end,
  a.id,
  a.tenant_id, a.empresa_id,
  null::uuid                                as conta_bancaria_id,
  a.data_prevista_pagamento,
  a.valor::numeric(14,2),
  a.natureza,
  a.descricao,
  a.fornecedor_id, a.cliente_id, a.job_id
from public.contas_avulsas a
where a.status = 'aprovada'

union all

-- Títulos em aberto (previsto entrada)
select
  'previsto',
  'titulo'::text                            as origem_tipo,
  t.id                                      as origem_id,
  t.tenant_id, t.empresa_id,
  null::uuid                                as conta_bancaria_id,
  t.data_vencimento                         as data_evento,
  t.valor,
  'entrada'::natureza_lancamento,
  ('Título NF ' || f.numero_nf || '/' || t.numero_parcela::text) as descricao,
  f.fornecedor_id, f.cliente_id,
  null::uuid                                as job_id
from public.titulos_receber t
join public.faturamentos f on f.id = t.faturamento_id
where t.status = 'em_aberto'

union all

-- Realizado (lancamentos financeiros)
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
