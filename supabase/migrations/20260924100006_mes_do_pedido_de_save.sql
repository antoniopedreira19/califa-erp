-- =============================================================================
-- O mês do pedido de save no modelo mensal (decisão 099, 24/09/2026)
-- =============================================================================
--
-- No Fee e no Always On (decisão 078) a planilha repete os mesmos grupos e
-- itens mês a mês, e o pedido de save guardava só "grupo · item": na fila,
-- no pop-up de aprovação e na Comunicação, dois pedidos de meses diferentes
-- apareciam iguais. O Tiago pediu o mês junto, só no mensal.
--
-- `mes_do_pedido(saves_aprovacoes)` é um campo calculado (o PostgREST o lê
-- como coluna: `select("..., mes_do_pedido")`): o mês da linha do pedido,
-- pela cadeia linha → grupo → mês da versão. Nulo fora do mensal e quando a
-- linha já não existe. SECURITY INVOKER: quem lê o pedido lê a linha com as
-- próprias policies.
--
-- Nenhum dado muda nesta migration.
-- =============================================================================

create or replace function public.mes_do_pedido(a public.saves_aprovacoes)
returns date
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select m.mes
    from public.jobs_itens_orcado o
    join public.versoes_orcamento_grupos g on g.id = o.grupo_id
    join public.versoes_orcamento_meses m on m.id = g.mes_id
   where o.id = a.job_item_orcado_id;
$$;

revoke all on function public.mes_do_pedido(public.saves_aprovacoes) from public, anon;
grant execute on function public.mes_do_pedido(public.saves_aprovacoes) to authenticated;

comment on function public.mes_do_pedido(public.saves_aprovacoes) is
  'Decisão 099 (24/09/2026): o mês da linha do pedido de save no modelo mensal (linha → grupo → mês da versão); nulo fora do mensal. Campo calculado do PostgREST.';
