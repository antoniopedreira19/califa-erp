-- =============================================================================
-- O financeiro vê o save na aprovação (decisão 099, parte 2)
-- =============================================================================
--
-- Regra fechada com o Tiago em 22/09/2026: a produção vê o pedido de save na
-- hora (planilha, cabeçalho e Totais do job), e o financeiro só na APROVAÇÃO.
-- Os espelhos do job (valor_total, faturamento_previsto,
-- faturamento_save_previsto) já seguem isso, porque só as RPCs de decisão os
-- gravam. Mas duas views do financeiro leem a linha crua, que muda no pedido:
--
--  - vw_fluxo_caixa: o CTE save_gerado soma as linhas em save (é o
--    denominador que reparte o dinheiro em save entre quem o consumiu), e o
--    CTE save_consumo_ord reparte esse dinheiro pelos consumos gravados;
--  - vw_job_rentabilidade: imposto previsto e custo realizado deixam de fora
--    as linhas em save.
--
-- Um pedido 'job_aberto' que aguarda mudava as duas antes de o financeiro
-- decidir, e voltava se ele recusasse. Aqui entra a linha "como o financeiro
-- vê", o equivalente SQL do helper itensParaOFinanceiro do TypeScript: o
-- pedido 'job_aberto' aguardando é desfeito na conta (a linha não é save; o
-- consumo é o de antes do pedido). Os demais momentos (abertura, reenvio,
-- legado) o financeiro já conferiu na abertura e contam como estão.
--
-- As duas views são recriadas a partir da definição VIVA (a vw_fluxo_caixa
-- tem 35 mil caracteres e muda com frequência), trocando só a tabela lida
-- nesses três pontos. Se a definição viva não tiver exatamente os pontos
-- esperados, a migration para em vez de adivinhar.
-- =============================================================================

create view public.vw_itens_orcado_financeiro
with (security_invoker = on) as
select o.id,
       o.tenant_id,
       o.job_id,
       o.tipo_custo,
       o.total_orcado,
       (o.em_save and not exists (
          select 1 from public.saves_aprovacoes pa
           where pa.job_item_orcado_id = o.id
             and pa.tipo = 'gera'
             and pa.situacao = 'aguardando'
             and pa.momento = 'job_aberto')) as em_save
  from public.jobs_itens_orcado o;

comment on view public.vw_itens_orcado_financeiro is
  'Linha do orçado do job como o financeiro vê (decisão 099): save gerado por errata de save que ainda aguarda aprovação não conta como save.';

grant select on public.vw_itens_orcado_financeiro to authenticated;

create view public.vw_saves_consumos_financeiro
with (security_invoker = on) as
select c.id,
       c.tenant_id,
       c.job_origem_id,
       c.job_item_orcado_id,
       c.valor,
       c.created_at
  from public.saves_consumos c
 where c.job_item_orcado_id is not null
   and not exists (
     select 1 from public.saves_aprovacoes pa
      where pa.job_item_orcado_id = c.job_item_orcado_id
        and pa.situacao = 'aguardando'
        and pa.momento = 'job_aberto')
union all
select pa.id,
       pa.tenant_id,
       (e.o->>'job_origem_id')::uuid,
       pa.job_item_orcado_id,
       (e.o->>'valor')::numeric,
       -- O consumo de antes começou a contar quando foi aprovado.
       coalesce(sub.decidido_em, pa.enviado_em)
  from public.saves_aprovacoes pa
  cross join lateral jsonb_array_elements(pa.origens_antes) e(o)
  left join public.saves_aprovacoes sub on sub.id = pa.substitui_id
 where pa.tipo = 'consome'
   and pa.situacao = 'aguardando'
   and pa.momento = 'job_aberto'
   and pa.job_item_orcado_id is not null;

comment on view public.vw_saves_consumos_financeiro is
  'Consumo de save das linhas de job como o financeiro vê (decisão 099): na linha com errata de save aguardando aprovação vale o consumo de antes do pedido.';

grant select on public.vw_saves_consumos_financeiro to authenticated;

do $$
declare
  v_def text;
  v_qtd integer;
begin
  -- vw_fluxo_caixa
  v_def := rtrim(btrim(pg_get_viewdef('public.vw_fluxo_caixa'::regclass)), ';');

  select count(*) into v_qtd
    from regexp_matches(v_def, 'jobs_itens_orcado o(\s+WHERE o\.em_save)', 'g');
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 leitura de linha em save no CTE save_gerado, achei %.', v_qtd;
  end if;
  select count(*) into v_qtd
    from regexp_matches(v_def, '\msaves_consumos c\M', 'g');
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 leitura de saves_consumos no CTE save_consumo_ord, achei %.', v_qtd;
  end if;

  v_def := regexp_replace(v_def, 'jobs_itens_orcado o(\s+WHERE o\.em_save)', 'vw_itens_orcado_financeiro o\1');
  v_def := regexp_replace(v_def, '\msaves_consumos c\M', 'vw_saves_consumos_financeiro c');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;

  -- vw_job_rentabilidade (security_invoker, mantido)
  v_def := rtrim(btrim(pg_get_viewdef('public.vw_job_rentabilidade'::regclass)), ';');

  select count(*) into v_qtd
    from regexp_matches(v_def, '\mjobs_itens_orcado jio\M', 'g');
  if v_qtd <> 2 then
    raise exception 'vw_job_rentabilidade: esperava 2 leituras do orçado com filtro de save, achei %.', v_qtd;
  end if;

  v_def := regexp_replace(v_def, '\mjobs_itens_orcado jio\M', 'vw_itens_orcado_financeiro jio', 'g');
  execute 'create or replace view public.vw_job_rentabilidade with (security_invoker = true) as ' || v_def;
end;
$$;
