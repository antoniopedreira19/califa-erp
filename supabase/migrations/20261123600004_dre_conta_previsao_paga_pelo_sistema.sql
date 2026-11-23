-- O DRE conta a previsão da planilha paga por baixa do sistema (revisão da
-- decisão 270, 23/11/2026; pedido do Tiago: "Vamos garantir a consistência da
-- DRE para conseguirmos acertar os fechamentos").
--
-- O problema: os relatórios do histórico (DRE, Resultado por regional e
-- Rentabilidade dos jobs) contam a previsão da planilha só quando ela está
-- ligada a uma linha do banco (`extrato_linha_id`, decisão 232). Desde a
-- conciliação dia a dia (decisão 262), muita linha do banco é conciliada com a
-- baixa do sistema (a PP, o custo fixo), e a previsão da planilha do mesmo
-- pagamento fica solta: some dos relatórios. Em 23/11, na California
-- Santander: 332 linhas do banco assim, 263 com a previsão de mesma data e
-- valor; fora do DRE padrão do 4T, cerca de R$ 1,28 mi (CO −1.095.349,96, CF
-- −123.657,47, DA, DC, DP) e R$ 59.590,00 de CO do 3T.
--
-- A regra: a previsão conta como acontecida também quando
--   (a) está ligada, em `historico_movimento_baixas`, a uma baixa já conciliada
--       com o banco; ou
--   (b) tem a mesma conta, o mesmo dia e o mesmo valor de uma linha do banco
--       conciliada só com lançamentos do sistema (nenhuma linha da planilha
--       ligada a ela), uma a uma: com duas previsões e duas linhas iguais, a
--       primeira com a primeira.
-- Nada é gravado: a regra é lida na hora, então vale para as conciliações que
-- vierem e não se perde quando a planilha é recarregada. O saldo e o Extrato
-- não mudam (a previsão sem linha do banco continua fora do saldo). O que não
-- casa exato (linha do banco dividida em várias previsões) continua fora até
-- ser ligado em `historico_movimento_baixas`.
--
-- Não mexe na carga da planilha nem nas funções da conciliação: as três
-- funções dos relatórios só trocam a condição da previsão, conferida trecho a
-- trecho (o resto do corpo é o de produção).

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
   where b.tenant_id = p_tenant_id
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
       where m.tenant_id = p_tenant_id
         and m.extrato_linha_id is null
         and m.valor <> 0
         and not exists (select 1 from public.historico_movimento_baixas hb where hb.historico_movimento_id = m.id)
    ) p
    join (
      select e.id, e.conta_bancaria_id, e.data, e.valor,
             row_number() over (partition by e.conta_bancaria_id, e.data, e.valor order by e.id) as k
        from public.extrato_linhas e
        join public.contas_bancarias cb on cb.id = e.conta_bancaria_id and cb.tenant_id = p_tenant_id
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

comment on function public._historico_previsoes_pagas(uuid) is
  'Revisão da decisão 270 (23/11/2026): as previsões da planilha já pagas por baixa do sistema conciliada com o banco (ligadas em historico_movimento_baixas, ou de mesma conta, dia e valor da linha do banco, uma a uma). Lida pelos relatórios do histórico; nada é gravado.';

-- As três funções dos relatórios: só a condição da previsão muda.
do $$
declare
  v_def   text;
  v_novo  text;
  v_pagas constant text := 'm.id in (select x from public._historico_previsoes_pagas(p_tenant_id) x)';
begin
  -- DRE: duas somas e a contagem das previsões em aberto.
  v_def := pg_get_functiondef('public.historico_dre(uuid,integer,text[],boolean)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'p_previsoes or m.extrato_linha_id is not null', ''))) / length('p_previsoes or m.extrato_linha_id is not null') <> 2 then
    raise exception 'historico_dre: a condição da previsão não apareceu 2 vezes.';
  end if;
  v_novo := replace(v_def, 'p_previsoes or m.extrato_linha_id is not null',
                    'p_previsoes or m.extrato_linha_id is not null or ' || v_pagas);
  if position(E'     and m.extrato_linha_id is null\n     and m.competencia_ano = p_ano;' in v_novo) = 0 then
    raise exception 'historico_dre: a contagem das previsões em aberto não foi achada.';
  end if;
  v_novo := replace(v_novo, E'     and m.extrato_linha_id is null\n     and m.competencia_ano = p_ano;',
                    E'     and m.extrato_linha_id is null\n     and m.id not in (select x from public._historico_previsoes_pagas(p_tenant_id) x)\n     and m.competencia_ano = p_ano;');
  execute v_novo;

  -- Resultado por regional: duas somas.
  v_def := pg_get_functiondef('public.historico_regional(uuid,integer,text[])'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'm.carga_id = any(v_previstas) and m.extrato_linha_id is not null)', ''))) / length('m.carga_id = any(v_previstas) and m.extrato_linha_id is not null)') <> 2 then
    raise exception 'historico_regional: a condição da previsão não apareceu 2 vezes.';
  end if;
  execute replace(v_def, 'm.carga_id = any(v_previstas) and m.extrato_linha_id is not null)',
                  'm.carga_id = any(v_previstas) and (m.extrato_linha_id is not null or ' || v_pagas || '))');

  -- Rentabilidade dos jobs: uma soma.
  v_def := pg_get_functiondef('public.historico_rentabilidade_jobs(uuid,integer)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'm.carga_id = any(v_previstas) and m.extrato_linha_id is not null)', ''))) / length('m.carga_id = any(v_previstas) and m.extrato_linha_id is not null)') <> 1 then
    raise exception 'historico_rentabilidade_jobs: a condição da previsão não apareceu 1 vez.';
  end if;
  execute replace(v_def, 'm.carga_id = any(v_previstas) and m.extrato_linha_id is not null)',
                  'm.carga_id = any(v_previstas) and (m.extrato_linha_id is not null or ' || v_pagas || '))');
end;
$$;
