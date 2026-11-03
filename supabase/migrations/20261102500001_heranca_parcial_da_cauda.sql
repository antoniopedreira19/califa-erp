-- Herança parcial na troca da cauda (decisão 211).
--
-- Uma linha do banco pode pagar várias linhas da planilha. Na troca da cauda,
-- quem mantém o digital herda a ligação; quem mudou fica sem herança, e
-- `_historico_apagar_linhas` devolve a linha do banco a pendente. Quando parte
-- herdou e parte não, sobrava linha pendente com movimento preso a ela:
-- `_linha_pendente` responde "já está conciliada" e nem a conciliação nem o
-- desfazer resolvem. Em 02/11/2026 isso aconteceu com uma linha da GoCrazy
-- (ordem 3, R$ 3.004,31).
--
-- Duas mudanças aditivas:
-- 1. Ao concluir a cauda, a linha que voltou a pendente larga as heranças
--    parciais. Ela volta inteira para a conciliação.
-- 2. A linha da GoCrazy recupera a ligação de 30/10/2026: a nota de R$ 3.201,19
--    e a linha de R$ 196,88, que mudou de digital. Só preenche o que está vazio.

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
  v_repetidas integer;
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

  -- Outra carga de período ativa pode ter sido concluída com período cruzado
  -- depois que esta começou.
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

  -- A mesma linha da planilha na cauda e no só DRE contaria duas vezes no
  -- resultado.
  if v_carga.tipo in ('cauda', 'so_dre') then
    select count(*)::int into v_repetidas
      from public.historico_movimentos n
      join public.historico_movimentos o on o.digital = n.digital
      join public.historico_cargas c on c.id = o.carga_id
     where n.carga_id = v_carga.id
       and c.tenant_id = v_carga.tenant_id
       and c.situacao = 'ativa'
       and c.tipo in ('cauda', 'so_dre')
       and c.tipo <> v_carga.tipo;
    if v_repetidas > 0 then
      raise exception '% linha(s) desta carga já estão na carga ativa de outro tipo e contariam duas vezes no resultado.', v_repetidas;
    end if;
  end if;

  -- Substitui a carga ativa do mesmo período; a cauda, a cauda ativa; o só
  -- DRE, o só DRE ativo.
  select coalesce(array_agg(id), '{}') into v_antigas
    from public.historico_cargas
   where tenant_id = v_carga.tenant_id and situacao = 'ativa'
     and ((v_carga.tipo = 'periodo' and tipo = 'periodo'
           and periodo_de = v_carga.periodo_de and periodo_ate = v_carga.periodo_ate)
       or (v_carga.tipo = 'cauda' and tipo = 'cauda')
       or (v_carga.tipo = 'so_dre' and tipo = 'so_dre'));
  if cardinality(v_antigas) > 0 then
    if v_carga.tipo = 'cauda' then
      -- A mesma linha da planilha (digital), na mesma conta e no mesmo valor,
      -- herda a ligação com o banco; a antiga larga, e a linha do banco fica.
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
    perform public._historico_apagar_linhas(v_antigas);
    -- A linha do banco que perdeu parte das linhas da planilha voltou a
    -- pendente: a parte herdada larga, e a conciliação recomeça inteira.
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

  update public.historico_cargas
     set situacao = 'ativa', gravado = v_linhas, concluida_em = now(), concluida_por = v_uid
   where id = v_carga.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_carga.tenant_id, 'historico_carga', v_carga.id::text, 'historico.carga_concluida', v_uid,
          jsonb_build_object('nome', v_carga.nome, 'tipo', v_carga.tipo, 'periodo_de', v_carga.periodo_de, 'periodo_ate', v_carga.periodo_ate,
                             'planilha_versao', v_carga.planilha_versao, 'pacote', v_carga.pacote_arquivo,
                             'linhas', v_linhas, 'substituidas', to_jsonb(v_antigas), 'ligacoes_herdadas', v_herdadas));

  return jsonb_build_object('linhas', v_linhas, 'substituidas', cardinality(v_antigas), 'ligacoes_herdadas', v_herdadas);
end;
$function$;

do $$
declare
  v_linha extrato_linhas%rowtype;
  v_movimentos uuid[] := array['16fb9e76-9738-4297-b531-49e4354d9231', '19023c38-4a89-444e-82c4-6fedc2b0e615']::uuid[];
  v_uid uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
begin
  select * into v_linha from public.extrato_linhas
   where id = '691d9742-22f2-4fa9-9568-c3f5a076fc03' and conciliada_em is null;
  if not found then return; end if;

  update public.historico_movimentos
     set extrato_linha_id = v_linha.id
   where id = '19023c38-4a89-444e-82c4-6fedc2b0e615' and extrato_linha_id is null;
  if (select sum(valor) from public.historico_movimentos where extrato_linha_id = v_linha.id) <> v_linha.valor then
    raise exception 'A soma das linhas da planilha não bate com a linha do banco.';
  end if;

  update public.extrato_linhas
     set conciliada_como = 'historico', conciliada_em = now(), conciliada_por = v_uid
   where id = v_linha.id;
  perform public._auditar_extrato(v_linha, 'extrato.conciliado', v_uid,
    jsonb_build_object('como', 'historico', 'sozinha', null, 'historico', to_jsonb(v_movimentos),
                       'motivo', 'Ligação de 30/10/2026 recuperada depois da troca da cauda'));
end;
$$;
