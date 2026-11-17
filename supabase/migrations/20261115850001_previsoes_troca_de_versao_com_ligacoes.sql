-- =============================================================================
-- 20261115850001 — A troca das previsões da planilha com linhas já ligadas ao
-- banco (decisão 232, revisão de 15/11/2026; Tiago)
-- =============================================================================
-- Ao carregar uma versão nova das previsões, a linha já ligada ao banco herda
-- a ligação pela impressão digital (`digital`). A que não tem herdeira (a
-- planilha mudou a data ou o texto daquela linha) era movida para a carga
-- nova. Em 11/11/2026 a troca falhou duas vezes: o número da linha da planilha
-- (`aba`, `linha`) se repete entre versões, porque a planilha insere e apaga
-- linhas, e a carga nova já tinha outra linha naquele número
-- (`uq_historico_movimentos_origem`). Foi preciso desfazer e refazer 31
-- conciliações à mão.
--
-- Agora, na troca de previsões:
-- 1. Herança pela digital, como antes.
-- 2. Herança pelo conteúdo: a linha nova da mesma conta, mesmo valor e mesmo
--    fornecedor, ainda sem ligação, com data até 31 dias da linha do banco (a
--    mais próxima). É a mesma linha da planilha com a data ou o texto
--    corrigidos; ela recebe a ligação e a data do banco (o gatilho de sempre).
-- 3. A que ainda fica sem herdeira passa à carga nova como antes; se o número
--    dela estiver ocupado na versão nova, ela vai para o primeiro número livre
--    a partir de 10.000.000 (fora do alcance das linhas da planilha), para a
--    conciliação dela não se perder.
--
-- Só muda o ramo das previsões. O resto da função é o mesmo da versão aplicada
-- (md5 do corpo antes desta migration: 4d4929c04b92cecc8635955d743fa7c2).
-- Mesma assinatura, SECURITY DEFINER e permissões.
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
    if v_carga.tipo = 'previsao' then
      -- 2. Herança pelo conteúdo: a mesma linha da planilha com a data ou o texto mudados.
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
           and lower(btrim(coalesce(n.fornecedor, ''))) = lower(btrim(coalesce(v_velha.fornecedor, '')))
           and abs(n.data - v_velha.data_banco) <= 31
         order by abs(n.data - v_velha.data_banco), n.id
         limit 1;
        if v_nova is not null then
          update public.historico_movimentos set extrato_linha_id = null where id = v_velha.id;
          update public.historico_movimentos set extrato_linha_id = v_velha.extrato_linha_id where id = v_nova;
          v_conteudo := v_conteudo + 1;
        end if;
        v_nova := null;
      end loop;

      -- 3. A que segue sem herdeira passa à carga nova, num número livre se o dela estiver ocupado.
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
                             'ligacoes_herdadas_pelo_conteudo', v_conteudo, 'ligadas_mantidas', v_movidas));

  return jsonb_build_object('linhas', v_linhas, 'substituidas', cardinality(v_antigas), 'ligacoes_herdadas', v_herdadas + v_conteudo,
                            'ligacoes_herdadas_pelo_conteudo', v_conteudo, 'ligadas_mantidas', v_movidas);
end;
$function$;
