-- O Fluxo de Caixa deixa de prever o que a baixa do sistema já pagou
-- (revisão da decisão 270, 23/11/2026; continuação da 20261123600004).
--
-- O problema: a previsão da planilha paga por baixa do sistema (conciliada
-- com o banco) continuava no ramo "previsao_planilha" da `vw_fluxo_caixa`,
-- empurrada para a próxima janela de pagamento: o mesmo pagamento saía como
-- realizado (a baixa) e como previsto. Em 23/11 eram 59 linhas, de 24/11 a
-- 08/12, R$ 3.272.744,71.
--
-- 1. `_historico_previsoes_pagas(null)` devolve as previsões pagas de todos os
--    tenants, para a view chamar uma vez só (sem correlação por linha). Os
--    relatórios do histórico continuam chamando com o tenant.
-- 2. O ramo "previsao_planilha" da view ganha só a condição
--    `h.id not in (_historico_previsoes_pagas(null))`. O resto da definição é
--    a de produção, relida aqui (pg_get_viewdef) e trocada num trecho
--    conferido: as outras exclusões continuam, inclusive a da recorrência com
--    a mesma `previsao_chave` (decisão 235, migrations 20261103800001 e
--    20261115800001, sem olhar ativo nem data_fim).
-- Conferido em ensaio: 7.345 → 7.286 linhas no tenant (as 59), mesmo tempo da
-- view (0,5 s) e do resumo por job (0,1 s).

create or replace function public._historico_previsoes_pagas(p_tenant_id uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  -- (a) ligada a uma baixa já conciliada com o banco.
  select b.historico_movimento_id
    from public.historico_movimento_baixas b
    join public.historico_movimentos m on m.id = b.historico_movimento_id
    join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
    join public.lancamentos_financeiros l on l.id = b.lancamento_id
   where (p_tenant_id is null or b.tenant_id = p_tenant_id)
     and m.extrato_linha_id is null
     and l.extrato_linha_id is not null
  union
  -- (b) mesma conta, dia e valor de uma linha do banco conciliada só com
  -- lançamentos do sistema, uma a uma.
  select p.id
    from (
      select m.id, m.conta_bancaria_id, m.data, m.valor,
             row_number() over (partition by m.conta_bancaria_id, m.data, m.valor order by m.aba, m.linha, m.id) as k
        from public.historico_movimentos m
        join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
       where (p_tenant_id is null or m.tenant_id = p_tenant_id)
         and m.extrato_linha_id is null
         and m.valor <> 0
         and not exists (select 1 from public.historico_movimento_baixas hb where hb.historico_movimento_id = m.id)
    ) p
    join (
      select e.id, e.conta_bancaria_id, e.data, e.valor,
             row_number() over (partition by e.conta_bancaria_id, e.data, e.valor order by e.id) as k
        from public.extrato_linhas e
        join public.contas_bancarias cb on cb.id = e.conta_bancaria_id and (p_tenant_id is null or cb.tenant_id = p_tenant_id)
       where e.data >= cb.saldo_inicial_data
         and e.ignorada_em is null
         and exists (select 1 from public.lancamentos_financeiros l where l.extrato_linha_id = e.id)
         and not exists (
           select 1 from public.historico_movimentos h
             join public.historico_cargas c on c.id = h.carga_id and c.situacao = 'ativa'
            where h.extrato_linha_id = e.id)
         and not exists (
           select 1 from public.historico_movimento_baixas hb
             join public.lancamentos_financeiros l on l.id = hb.lancamento_id
            where l.extrato_linha_id = e.id)
    ) b on b.conta_bancaria_id = p.conta_bancaria_id and b.data = p.data and b.valor = p.valor and b.k = p.k;
$function$;

revoke all on function public._historico_previsoes_pagas(uuid) from public, anon, authenticated;

do $$
declare
  v_def    text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  v_ancora constant text := 'WHERE ((h.extrato_linha_id IS NULL) AND (h.valor <> (0)::numeric)';
begin
  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'vw_fluxo_caixa: o ramo da previsão da planilha não apareceu 1 vez.';
  end if;
  execute 'create or replace view public.vw_fluxo_caixa as ' || replace(v_def, v_ancora,
    v_ancora || ' AND (NOT (h.id IN ( SELECT x.x FROM public._historico_previsoes_pagas(NULL::uuid) x(x))))');
end;
$$;
