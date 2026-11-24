-- =============================================================================
-- 20261123980001 — A troca de carga do histórico preserva as ligações com as
-- baixas e herda pelo conteúdo também na cauda (decisão 211; fechamento do 3T,
-- 23/11/2026; Tiago: "vamos unificar os lançamentos")
-- =============================================================================
-- Para o fechamento do 3T, as cargas do histórico vão ser trocadas pela mesma
-- versão da planilha (até 30/09, outubro e as previsões). A troca apaga as
-- linhas da carga antiga (`_historico_apagar_linhas`), e dois furos apareceram
-- na conferência antes da carga:
--
-- 1. `historico_movimento_baixas` (decisão 270, criada em 23/11) aponta para a
--    linha antiga com ON DELETE CASCADE. Na troca, a ligação da linha da
--    planilha com a baixa do sistema sumia em silêncio: 54 ligações hoje
--    (1ª carga 14, 3T 15, cauda 3, só DRE 16, previsões 6). Essas ligações
--    fazem o DRE contar a previsão paga e o fluxo tirá-la.
--    Agora a ligação passa para a linha nova com a mesma digital, conta e
--    valor (e, na cauda e nas previsões, para a herdeira pelo conteúdo). Se
--    uma linha ligada a uma baixa não tem herdeira e não fica (só a previsão
--    ligada ao banco fica), a conclusão é recusada: nada se perde sem aviso.
--
-- 2. A cauda só herdava a ligação com o banco pela digital. Linha que a
--    planilha editou (fornecedor, texto, job) perdia a ligação e a linha do
--    banco voltava a pendente. Agora a cauda também herda pelo conteúdo, com
--    a mesma regra das previsões (20261115850002): conta, valor, fornecedor
--    pelas 8 primeiras letras e até 31 dias da linha do banco. Na cauda, a
--    ligada sem herdeira continua a sair (a linha antiga não fica, ou
--    contaria duas vezes no resultado ao lado da linha nova).
--
-- O resto da função é o da 20261115850002.
-- =============================================================================

create or replace function public.historico_concluir_carga(p_carga_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_carga     public.historico_cargas%rowtype;
  v_uid       uuid;
  v_linhas    jsonb;
  v_tabela    text;
  v_soma      numeric;
  v_antigas   uuid[];
  v_cruzada   record;
  v_herdadas  integer := 0;
  v_conteudo  integer := 0;
  v_movidas   integer := 0;
  v_baixas    integer := 0;
  v_sem_baixa integer := 0;
  v_repetidas integer;
  v_velha     record;
  v_nova      uuid;
  v_livre     integer;
begin
  select * into v_carga from public.historico_cargas where id = p_carga_id for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  v_uid := public._exige_financeiro_historico(v_carga.tenant_id);
  if v_carga.situacao <> 'carregando' then
    raise exception 'Esta carga não está em andamento.';
  end if;

  v_linhas := public._historico_contar_linhas(v_carga.id);
  foreach v_tabela in array array['rateio', 'saldos', 'jobs', 'notas', 'movimentos'] loop
    if (v_linhas->>v_tabela)::integer is distinct from (v_carga.esperado->v_tabela->>'linhas')::integer then
      raise exception 'A carga não está completa: % de % linhas de %.',
        v_linhas->>v_tabela, coalesce(v_carga.esperado->v_tabela->>'linhas', '?'), v_tabela;
    end if;
  end loop;
  select coalesce(sum(valor), 0) into v_soma from public.historico_movimentos where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'movimentos'->>'soma')::numeric then
    raise exception 'A soma dos movimentos no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'movimentos'->>'soma';
  end if;
  select coalesce(sum(valor), 0) into v_soma from public.historico_notas where carga_id = v_carga.id;
  if v_soma is distinct from (v_carga.esperado->'notas'->>'soma')::numeric then
    raise exception 'A soma das notas no banco (%) não bate com a do pacote (%).',
      v_soma, v_carga.esperado->'notas'->>'soma';
  end if;

  select nome, periodo_de, periodo_ate into v_cruzada
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa' and tipo = 'periodo'
     and periodo_de <= v_carga.periodo_ate and periodo_ate >= v_carga.periodo_de
     and not (v_carga.tipo = 'periodo' and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
   limit 1;
  if found then
    raise exception 'O período cruza o da carga "%" (% a %). Desfaça aquela carga antes de concluir esta.',
      v_cruzada.nome, to_char(v_cruzada.periodo_de, 'DD/MM/YYYY'), to_char(v_cruzada.periodo_ate, 'DD/MM/YYYY');
  end if;

  if v_carga.tipo in ('cauda', 'so_dre', 'previsao') then
    select count(*)::int into v_repetidas
      from public.historico_movimentos n
      join public.historico_movimentos o on o.digital = n.digital
      join public.historico_cargas c on c.id = o.carga_id
     where n.carga_id = v_carga.id
       and c.tenant_id = v_carga.tenant_id
       and c.situacao = 'ativa'
       and c.tipo in ('cauda', 'so_dre', 'previsao')
       and c.tipo <> v_carga.tipo;
    if v_repetidas > 0 then
      raise exception '% linha(s) desta carga já estão na carga ativa de outro tipo e contariam duas vezes no resultado.', v_repetidas;
    end if;
  end if;

  select coalesce(array_agg(id), '{}') into v_antigas
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa'
     and ((v_carga.tipo = 'periodo' and tipo = 'periodo'
           and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
       or (v_carga.tipo = 'cauda' and tipo = 'cauda')
       or (v_carga.tipo = 'so_dre' and tipo = 'so_dre')
       or (v_carga.tipo = 'previsao' and tipo = 'previsao'));
  if cardinality(v_antigas) > 0 then
    -- A ligação com o banco, pela digital, conta e valor.
    if v_carga.tipo in ('cauda', 'previsao') then
      with herdadas as (
        update public.historico_movimentos n
           set extrato_linha_id = o.extrato_linha_id
          from public.historico_movimentos o
         where n.carga_id = v_carga.id
           and o.carga_id = any(v_antigas)
           and o.extrato_linha_id is not null
           and n.extrato_linha_id is null
           and n.digital = o.digital
           and n.conta_bancaria_id is not distinct from o.conta_bancaria_id
           and n.valor = o.valor
        returning o.id
      )
      update public.historico_movimentos
         set extrato_linha_id = null
       where id in (select id from herdadas);
      get diagnostics v_herdadas = row_count;
    end if;

    -- A ligação com a baixa (decisão 270), pela digital, conta e valor: uma linha nova para cada antiga.
    with antigas as (
      select o.id, o.digital, o.conta_bancaria_id, o.valor,
             row_number() over (partition by o.digital, o.conta_bancaria_id, o.valor order by o.id) as n
        from public.historico_movimentos o
       where o.carga_id = any(v_antigas)
         and exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = o.id)
    ), novas as (
      select m.id, m.digital, m.conta_bancaria_id, m.valor,
             row_number() over (partition by m.digital, m.conta_bancaria_id, m.valor order by m.id) as n
        from public.historico_movimentos m
       where m.carga_id = v_carga.id
    ), pares as (
      select a.id as antiga, n.id as nova
        from antigas a
        join novas n on n.digital = a.digital and n.conta_bancaria_id is not distinct from a.conta_bancaria_id
                    and n.valor = a.valor and n.n = a.n
    )
    insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, ligado_por, created_at)
    select p.nova, b.lancamento_id, b.tenant_id, b.ligado_por, b.created_at
      from pares p
      join public.historico_movimento_baixas b on b.historico_movimento_id = p.antiga
    on conflict do nothing;
    get diagnostics v_baixas = row_count;

    -- A ligação com o banco pelo conteúdo (conta, valor, fornecedor e até 31 dias), na cauda e nas previsões.
    if v_carga.tipo in ('cauda', 'previsao') then
      for v_velha in
        select o.id, o.extrato_linha_id, o.conta_bancaria_id, o.valor, o.fornecedor, e.data as data_banco
          from public.historico_movimentos o
          join public.extrato_linhas e on e.id = o.extrato_linha_id
         where o.carga_id = any(v_antigas)
           and o.extrato_linha_id is not null
         order by e.data, o.id
      loop
        select n.id into v_nova
          from public.historico_movimentos n
         where n.carga_id = v_carga.id
           and n.extrato_linha_id is null
           and n.conta_bancaria_id is not distinct from v_velha.conta_bancaria_id
           and n.valor = v_velha.valor
           and length(public._historico_nome_comparavel(v_velha.fornecedor)) >= 4
           and left(public._historico_nome_comparavel(n.fornecedor), 8) = left(public._historico_nome_comparavel(v_velha.fornecedor), 8)
           and abs(n.data - v_velha.data_banco) <= 31
         order by (lower(btrim(coalesce(n.fornecedor, ''))) = lower(btrim(coalesce(v_velha.fornecedor, '')))) desc,
                  abs(n.data - v_velha.data_banco), n.id
         limit 1;
        if v_nova is not null then
          update public.historico_movimentos set extrato_linha_id = null where id = v_velha.id;
          update public.historico_movimentos set extrato_linha_id = v_velha.extrato_linha_id where id = v_nova;
          -- A baixa da linha antiga, se ainda não passou pela digital, vai junto com a ligação do banco.
          insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, ligado_por, created_at)
          select v_nova, b.lancamento_id, b.tenant_id, b.ligado_por, b.created_at
            from public.historico_movimento_baixas b
           where b.historico_movimento_id = v_velha.id
             and not exists (select 1 from public.historico_movimento_baixas x
                               join public.historico_movimentos m on m.id = x.historico_movimento_id
                              where x.lancamento_id = b.lancamento_id and m.carga_id = v_carga.id)
          on conflict do nothing;
          v_conteudo := v_conteudo + 1;
        end if;
        v_nova := null;
      end loop;
    end if;

    -- Nas previsões, a ligada ao banco sem herdeira fica (muda de carga), com as baixas dela.
    if v_carga.tipo = 'previsao' then
      for v_velha in
        select o.id, o.aba, o.linha
          from public.historico_movimentos o
         where o.carga_id = any(v_antigas)
           and o.extrato_linha_id is not null
           and exists (select 1 from public.historico_movimentos n
                        where n.carga_id = v_carga.id and n.aba = o.aba and n.linha = o.linha)
         order by o.id
      loop
        select greatest(10000000, coalesce(max(m.linha), 0) + 1) into v_livre
          from public.historico_movimentos m
         where m.carga_id in (select unnest(v_antigas) union select v_carga.id)
           and m.aba = v_velha.aba
           and m.linha >= 10000000;
        update public.historico_movimentos set linha = v_livre where id = v_velha.id;
      end loop;
      update public.historico_movimentos
         set carga_id = v_carga.id
       where carga_id = any(v_antigas)
         and extrato_linha_id is not null;
      get diagnostics v_movidas = row_count;
    end if;

    -- Nenhuma baixa perde a ligação sem aviso: a que não passou para a carga nova recusa a troca.
    select count(*)::int into v_sem_baixa
      from public.historico_movimento_baixas b
      join public.historico_movimentos o on o.id = b.historico_movimento_id
     where o.carga_id = any(v_antigas)
       and not exists (select 1 from public.historico_movimento_baixas x
                         join public.historico_movimentos m on m.id = x.historico_movimento_id
                        where x.lancamento_id = b.lancamento_id and m.carga_id = v_carga.id);
    if v_sem_baixa > 0 then
      raise exception '% ligação(ões) de linha da planilha com baixa do sistema não acham a linha na versão nova. Desfaça a ligação na conciliação antes de trocar a carga.', v_sem_baixa;
    end if;

    perform public._historico_apagar_linhas(v_antigas);
    if v_carga.tipo = 'cauda' then
      update public.historico_movimentos n
         set extrato_linha_id = null
        from public.extrato_linhas e
       where n.carga_id = v_carga.id
         and e.id = n.extrato_linha_id
         and e.conciliada_em is null;
    end if;
    update public.historico_cargas
       set situacao = 'substituida', encerrada_em = now(), encerrada_por = v_uid, substituida_por = v_carga.id
     where id = any(v_antigas);
  end if;

  if v_carga.tipo = 'cauda' then
    with realizadas as (
      select distinct on (p.id) p.id as previsao_id, n.id as cauda_id, p.extrato_linha_id
        from public.historico_movimentos p
        join public.historico_cargas pc on pc.id = p.carga_id and pc.tipo = 'previsao' and pc.situacao = 'ativa'
        join public.historico_movimentos n
          on n.carga_id = v_carga.id
         and n.extrato_linha_id is null
         and n.conta_bancaria_id is not distinct from p.conta_bancaria_id
         and n.valor = p.valor
         and n.data = p.data
       where pc.tenant_id = v_carga.tenant_id
         and p.extrato_linha_id is not null
       order by p.id, n.id
    ), herdou as (
      update public.historico_movimentos n
         set extrato_linha_id = r.extrato_linha_id
        from realizadas r
       where n.id = r.cauda_id
      returning r.previsao_id
    )
    delete from public.historico_movimentos where id in (select previsao_id from herdou);
  end if;

  update public.historico_cargas
     set situacao = 'ativa', gravado = v_linhas, concluida_em = now(), concluida_por = v_uid
   where id = v_carga.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_carga.tenant_id, 'historico_carga', v_carga.id::text, 'historico.carga_concluida', v_uid,
          jsonb_build_object('nome', v_carga.nome, 'tipo', v_carga.tipo, 'periodo_de', v_carga.periodo_de, 'periodo_ate', v_carga.periodo_ate,
                             'planilha_versao', v_carga.planilha_versao, 'pacote', v_carga.pacote_arquivo,
                             'linhas', v_linhas, 'substituidas', to_jsonb(v_antigas), 'ligacoes_herdadas', v_herdadas,
                             'ligacoes_herdadas_pelo_conteudo', v_conteudo, 'ligadas_mantidas', v_movidas,
                             'baixas_herdadas', v_baixas));

  return jsonb_build_object('linhas', v_linhas, 'substituidas', cardinality(v_antigas), 'ligacoes_herdadas', v_herdadas + v_conteudo,
                            'ligacoes_herdadas_pelo_conteudo', v_conteudo, 'ligadas_mantidas', v_movidas,
                            'baixas_herdadas', v_baixas);
end;
$function$;

comment on function public.historico_concluir_carga(uuid) is
  'Decisão 211 (revisão de 23/11/2026): conclui a carga e troca a ativa do mesmo tipo. Herda a ligação com o banco pela digital e, na cauda e nas previsões, pelo conteúdo; passa a ligação com a baixa (historico_movimento_baixas) para a linha nova e recusa a troca se alguma ficaria sem linha.';
