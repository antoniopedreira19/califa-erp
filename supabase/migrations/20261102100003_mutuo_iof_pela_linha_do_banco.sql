-- =====================================================================
-- Mútuo (decisão 230): a guia do histórico fica presa à linha do banco
-- =====================================================================
--
-- A marcação de 20261102100001 lia o valor da linha da planilha pela digital.
-- A digital muda quando a descrição, o fornecedor, o Tipo, o job, o evento, a
-- data ou o valor mudam na planilha, e a tela perdia a guia sem aviso. A linha
-- do banco não depende da planilha: é o dinheiro que saiu, e não muda a cada
-- troca de cauda.
--
-- A marcação ganha `extrato_linha_id`, e a view passa a ler o valor da linha
-- do banco. Com isso, a carga ativa deixa de importar. A digital fica só como
-- registro de qual linha da planilha foi marcada.
--
-- ON DELETE RESTRICT, como em `lancamentos_financeiros`: a linha do banco
-- marcada não some sem alguém desfazer a marcação.
--
-- Entra também o índice da FK do pagador, que o advisor apontou.
-- =====================================================================

alter table public.mutuos_iof_historico
  add column if not exists extrato_linha_id uuid references public.extrato_linhas(id) on delete restrict;

update public.mutuos_iof_historico m
   set extrato_linha_id = h.extrato_linha_id
  from public.historico_movimentos h
  join public.historico_cargas c on c.id = h.carga_id and c.situacao = 'ativa'
 where m.extrato_linha_id is null
   and h.tenant_id = m.tenant_id
   and h.digital = m.digital
   and h.extrato_linha_id is not null;

alter table public.mutuos_iof_historico
  alter column extrato_linha_id set not null;

comment on table public.mutuos_iof_historico is
  'Linha do banco conciliada com o histórico da planilha que é IOF de um mútuo (decisão 230). Só marca: o dinheiro continua no histórico.';
comment on column public.mutuos_iof_historico.digital is
  'A linha da planilha marcada. Só registro: o valor vem da linha do banco.';

create unique index if not exists uq_mutuos_iof_historico_extrato_linha
  on public.mutuos_iof_historico (extrato_linha_id);
create index if not exists idx_mutuos_iof_historico_pagador
  on public.mutuos_iof_historico (pagador_empresa_contabil_id);

create or replace view public.vw_mutuos_iof_historico
with (security_invoker = true) as
select
  m.tenant_id,
  m.digital,
  m.pagador_empresa_contabil_id,
  m.com_empresa_contabil_id,
  m.com_fornecedor_id,
  abs(e.valor)::numeric(14,2) as valor
from public.mutuos_iof_historico m
join public.extrato_linhas e on e.id = m.extrato_linha_id;

comment on view public.vw_mutuos_iof_historico is
  'O IOF marcado em mutuos_iof_historico, com o valor da linha do banco.';
