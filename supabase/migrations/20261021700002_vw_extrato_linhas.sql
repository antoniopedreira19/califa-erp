-- =====================================================================
-- A linha do extrato importado com a situação dela
-- (task 029, fase 3, entrega 3A — decisão 199)
-- =====================================================================
--
-- "Conciliada" não é coluna: é ter um lançamento ligado
-- (`lancamentos_financeiros.extrato_linha_id`, decisão 199, M3.3). A aba
-- Banco da conciliação precisa, numa leitura só, das linhas pendentes de
-- qualquer data (sem lançamento e não ignoradas) e das resolvidas do
-- período aberto — e o PostgREST não filtra "sem linha embutida" dentro de
-- um `or`. A view expõe o `conciliada` calculado, e o filtro vira um `or`
-- comum.
--
-- `security_invoker`: quem lê passa pela RLS de `extrato_linhas` (só admin
-- e financeiro do tenant) e pela de `lancamentos_financeiros` — a mesma
-- visão que o Extrato da conta tem.
--
-- Aditiva: uma view nova, sem tocar em tabela.
-- =====================================================================

create or replace view public.vw_extrato_linhas
with (security_invoker = true) as
select
  l.*,
  exists (
    select 1
    from public.lancamentos_financeiros f
    where f.extrato_linha_id = l.id
  ) as conciliada
from public.extrato_linhas l;

comment on view public.vw_extrato_linhas is
  'As linhas do extrato importado com conciliada = tem lançamento ligado (decisão 199).';

revoke all on public.vw_extrato_linhas from public, anon, authenticated;
grant select on public.vw_extrato_linhas to authenticated;
