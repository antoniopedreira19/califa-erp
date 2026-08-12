-- =====================================================================
-- Contas avulsas — Migration B: remove valor 'pendente' do enum
-- Aplicada manualmente via execute_sql porque apply_migration nao suportava
-- a combinacao de rename + create type com constraints dependentes.
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 0. Guarda: aborta se ainda houver registros com pendente
do $$
declare v_count integer;
begin
  select count(*) into v_count
    from public.contas_avulsas
   where status::text = 'pendente';
  if v_count > 0 then
    raise exception
      'Ainda existem % contas avulsas com status=pendente. Migre antes de rodar esta migration.', v_count;
  end if;
end $$;

-- 1. Drop views dependentes da coluna status
drop view if exists public.vw_fluxo_caixa;
drop view if exists public.vw_a_pagar;

-- 2. Drop constraints e index que dependem do tipo enum
alter table public.contas_avulsas drop constraint chk_avulsa_aprovada_consistente;
alter table public.contas_avulsas drop constraint chk_avulsa_baixa_consistente;
drop index if exists public.idx_avulsas_aprovada_prazo;

-- 3. Renomeia enum antigo, cria enum novo sem 'pendente', migra a coluna
alter type conta_avulsa_status rename to conta_avulsa_status_old;

create type conta_avulsa_status as enum ('aprovada','baixada');

alter table public.contas_avulsas alter column status drop default;

alter table public.contas_avulsas
  alter column status type conta_avulsa_status
  using status::text::conta_avulsa_status;

alter table public.contas_avulsas alter column status set default 'aprovada';

drop type conta_avulsa_status_old;

-- 4. Recria constraints atualizadas (sem 'pendente')
alter table public.contas_avulsas add constraint chk_avulsa_aprovada_consistente check (
  aprovada_em is not null and aprovada_por is not null
);

alter table public.contas_avulsas add constraint chk_avulsa_baixa_consistente check (
  (status = 'baixada' and pago_em is not null and pago_por is not null and conta_bancaria_baixa_id is not null)
  or (status <> 'baixada' and pago_em is null and pago_por is null and conta_bancaria_baixa_id is null)
);

-- 5. Recria index parcial
create index idx_avulsas_aprovada_prazo on public.contas_avulsas
  using btree (tenant_id, data_prevista_pagamento)
  where status = 'aprovada';

-- 6. Recria vw_a_pagar
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

-- 7. Recria vw_fluxo_caixa
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
