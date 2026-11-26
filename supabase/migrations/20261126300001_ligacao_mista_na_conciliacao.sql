-- Decisão 281 — A ligação mista: a linha do banco que paga, num PIX só, títulos do
-- sistema e itens que só existem na planilha do financeiro (26/11/2026; plano da
-- conciliação das 3 contas aprovado pelo Tiago).
--
-- Até aqui a linha do banco se conciliava com lançamentos do sistema
-- (`conciliar_linha`) OU com linhas da planilha (`conciliar_linha_pelo_historico`),
-- nunca com os dois. O PIX que paga a PP-00303 junto com três itens de numeração
-- antiga da planilha (WRM, R$ 61.131, 23/11) não tinha saída sem contar em dobro:
-- ligar tudo à planilha deixa a PP aberta; dar baixa só na PP deixa a linha
-- sem fechar. Eram 19 linhas assim na California Santander, mais as baixas que o
-- financeiro deu à mão em 19/11 em PIX que também pagaram itens só da planilha.
--
-- O que muda:
-- 1. `conciliada_como` aceita 'misto'.
-- 2. `conciliar_linha_mista(linha, lançamentos, linhas da planilha)`: as mesmas
--    travas das duas funções de hoje (lançamento da conta e sem linha; planilha da
--    cauda ou das previsões ativas, da conta, sem linha, desde o início da conta),
--    a soma dos dois lados igual à linha do banco, a data dos lançamentos passa à do
--    banco (como na ligação). Depois, a baixa de cada PP liga-se à linha da planilha
--    que cita a PP (`historico_movimento_baixas`, a regra (a) de
--    `_historico_previsoes_pagas`): numa linha mista a regra (b) não se aplica (ela
--    só olha a linha conciliada só com lançamentos), e sem esse par a PP contaria
--    duas vezes no DRE com previsões. O par só sai quando há UMA linha da planilha
--    da mesma conta, solta, de mesmo valor, que cita a PP, a até 31 dias — senão a
--    função não liga e devolve a lista do que ficou sem par.
-- 3. `desfazer_conciliacao`: a linha mista solta os dois lados, devolve as datas
--    dos lançamentos e apaga os pares que ela criou. Não cancela baixa nenhuma
--    (como a ligação): a baixa que a ação criou volta a "Só no sistema".
-- 4. `lancamento_desliga_a_linha` (a baixa cancelada fora da conciliação): na
--    linha mista solta também a planilha e os pares.
-- 5. `_historico_apagar_linhas` (a carga desfeita): na linha mista solta também os
--    lançamentos.
--
-- Mudança aditiva: nenhuma linha existente muda (nenhuma está como 'misto'), e os
-- caminhos de hoje das outras formas de conciliar ficam iguais.

-- 1 ------------------------------------------------------------------------------
alter table public.extrato_linhas drop constraint chk_extrato_linha_conciliada_como;
alter table public.extrato_linhas add constraint chk_extrato_linha_conciliada_como
  check (conciliada_como is null or conciliada_como = any (array['ligacao', 'baixa', 'avulso', 'regra', 'par', 'correcao', 'historico', 'conjunto', 'misto']));

-- 2 ------------------------------------------------------------------------------
create or replace function public.conciliar_linha_mista(p_linha_id uuid, p_lancamento_ids uuid[], p_movimento_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid      uuid;
  v_linha    extrato_linhas%rowtype;
  v_inicio   date;
  v_ids      uuid[];
  v_n        integer;
  v_soma_l   numeric;
  v_soma_h   numeric;
  v_datas    jsonb := '[]'::jsonb;
  v_pares    jsonb := '[]'::jsonb;
  v_sem_par  jsonb := '[]'::jsonb;
  v_achadas  uuid[];
  r          record;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);
  if coalesce(cardinality(p_lancamento_ids), 0) = 0 or coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'A ligação mista junta lançamentos do sistema e linhas da planilha: escolha os dois.';
  end if;
  select saldo_inicial_data into v_inicio from public.contas_bancarias where id = v_linha.conta_bancaria_id;

  -- O lado do sistema: como em conciliar_linha (os juros e o imposto do mesmo
  -- pagamento entram junto).
  select array_agg(distinct l.id) into v_ids
    from public.lancamentos_financeiros l
   where l.id = any (p_lancamento_ids)
      or (l.origem = 'juros_baixa' and l.juros_de_lancamento_id = any (p_lancamento_ids))
      or (l.origem = 'imposto_baixa' and exists (
            select 1 from public.lancamentos_financeiros g
             where g.id = any (p_lancamento_ids) and g.origem = 'imposto_baixa'
               and g.imposto_a_pagar_id = l.imposto_a_pagar_id
               and g.conta_bancaria_id = l.conta_bancaria_id
               and g.data_movimento = l.data_movimento));
  if exists (select unnest(p_lancamento_ids) except select unnest(coalesce(v_ids, '{}'::uuid[]))) then
    raise exception 'Algum lançamento escolhido não existe mais: recarregue a página.';
  end if;
  perform 1 from public.lancamentos_financeiros where id = any (v_ids) for update;
  select count(*)::int, coalesce(sum(case when natureza = 'entrada' then valor else -valor end), 0)
    into v_n, v_soma_l
    from public.lancamentos_financeiros
   where id = any (v_ids)
     and tenant_id = v_linha.tenant_id
     and conta_bancaria_id = v_linha.conta_bancaria_id
     and extrato_linha_id is null;
  if v_n <> coalesce(cardinality(v_ids), 0) then
    raise exception 'Algum lançamento não é desta conta ou já está conciliado com outra linha.';
  end if;

  -- O lado da planilha: como em conciliar_linha_pelo_historico.
  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;
  select count(*)::int, coalesce(sum(h.valor), 0)
    into v_n, v_soma_h
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id
   where h.id = any (p_movimento_ids)
     and h.tenant_id = v_linha.tenant_id
     and h.conta_bancaria_id = v_linha.conta_bancaria_id
     and h.extrato_linha_id is null
     and c.tipo in ('cauda', 'previsao') and c.situacao = 'ativa'
     and h.data >= v_inicio
     and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
  if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
    raise exception 'Alguma linha da planilha não é da cauda nem das previsões desta conta, ou já está conciliada: recarregue a página.';
  end if;

  if abs(v_soma_l + v_soma_h - v_linha.valor) >= 0.005 then
    raise exception 'O sistema (%) e a planilha (%) somam %, e a linha do banco é %.',
      public._moeda_br(v_soma_l), public._moeda_br(v_soma_h), public._moeda_br(v_soma_l + v_soma_h), public._moeda_br(v_linha.valor);
  end if;

  for r in
    select id, data_movimento from public.lancamentos_financeiros
     where id = any (v_ids) and origem <> 'juros_baixa' and data_movimento <> v_linha.data
  loop
    perform public._mudar_data_do_lancamento(r.id, v_linha.data);
    v_datas := v_datas || jsonb_build_object('id', r.id, 'de', r.data_movimento);
  end loop;

  update public.lancamentos_financeiros set extrato_linha_id = v_linha.id where id = any (v_ids);
  update public.historico_movimentos set extrato_linha_id = v_linha.id where id = any (p_movimento_ids);

  -- A baixa de cada PP com a linha da planilha que cita a PP: uma só, da conta,
  -- solta, de mesmo valor, a até 31 dias.
  for r in
    select l.id, pc.codigo,
           case when l.natureza = 'entrada' then l.valor else -l.valor end as v,
           ltrim(regexp_replace(pc.codigo, '\D', '', 'g'), '0') as numero
      from public.lancamentos_financeiros l
      join public.pedidos_compra_parcelas pa on pa.id = l.pedido_compra_parcela_id
      join public.pedidos_compra pc on pc.id = pa.pedido_compra_id
     where l.id = any (v_ids) and l.origem = 'pp_baixa'
       and pc.codigo ~ '[1-9]'
       and not exists (select 1 from public.historico_movimento_baixas b where b.lancamento_id = l.id)
  loop
    select array_agg(h.id order by abs(h.data - v_linha.data), h.id) into v_achadas
      from public.historico_movimentos h
      join public.historico_cargas c on c.id = h.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
     where h.tenant_id = v_linha.tenant_id
       and h.conta_bancaria_id = v_linha.conta_bancaria_id
       and h.extrato_linha_id is null
       and abs(h.valor - r.v) < 0.005
       and abs(h.data - v_linha.data) <= 31
       and concat_ws(' ', h.descricao, h.documento, h.observacao) ~* ('PP[- ]?0*' || r.numero || '([^0-9]|$)')
       and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
    if coalesce(cardinality(v_achadas), 0) = 1 then
      insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, ligado_por)
      values (v_achadas[1], r.id, v_linha.tenant_id, v_uid);
      v_pares := v_pares || jsonb_build_object('historico_movimento_id', v_achadas[1], 'lancamento_id', r.id);
    else
      v_sem_par := v_sem_par || jsonb_build_object('lancamento_id', r.id, 'pp', r.codigo, 'candidatas', coalesce(cardinality(v_achadas), 0));
    end if;
  end loop;

  update public.extrato_linhas
     set conciliada_como = 'misto',
         conciliada_em = now(),
         conciliada_por = v_uid,
         desfazer = jsonb_build_object('datas', v_datas, 'pares', v_pares),
         grupo = null,
         resolvida_sozinha = null
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.conciliado', v_uid,
    jsonb_build_object('como', 'misto', 'lancamentos', to_jsonb(v_ids), 'historico', to_jsonb(p_movimento_ids),
                       'datas_trocadas', v_datas, 'pares', v_pares, 'sem_par', v_sem_par));

  return jsonb_build_object('lancamentos', to_jsonb(v_ids), 'historico', to_jsonb(p_movimento_ids),
                            'datas', v_datas, 'pares', v_pares, 'sem_par', v_sem_par);
end;
$function$;

revoke all on function public.conciliar_linha_mista(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.conciliar_linha_mista(uuid, uuid[], uuid[]) to authenticated;
comment on function public.conciliar_linha_mista(uuid, uuid[], uuid[]) is
  'Decisão 281: concilia a linha do banco com lançamentos do sistema e linhas da planilha ao mesmo tempo (a soma dos dois lados igual à linha) e liga a baixa de cada PP à linha da planilha que cita a PP.';

-- 3 ------------------------------------------------------------------------------
-- O desfazer da linha mista entra antes do caso da linha do histórico. O resto da
-- função é o de hoje: o texto é trocado no lugar, e a migration para se o trecho
-- de referência não estiver lá exatamente uma vez.
do $migration$
declare
  v_def   text := pg_get_functiondef('public.desfazer_conciliacao(uuid)'::regprocedure);
  v_ancora text := E'    -- A linha do histórico (A6): solta a cauda; nada a cancelar.\n';
  v_novo  text := E'    -- A linha mista (decisão 281): solta os dois lados, devolve as datas e\n'
               || E'    -- apaga os pares baixa × planilha que ela criou. Nada a cancelar.\n'
               || E'    if r_linha.conciliada_como = ''misto'' then\n'
               || E'      delete from public.historico_movimento_baixas b\n'
               || E'       using jsonb_array_elements(coalesce(r_linha.desfazer->''pares'', ''[]''::jsonb)) x\n'
               || E'       where b.historico_movimento_id = (x->>''historico_movimento_id'')::uuid\n'
               || E'         and b.lancamento_id = (x->>''lancamento_id'')::uuid;\n'
               || E'      update public.historico_movimentos set extrato_linha_id = null where extrato_linha_id = r_linha.id;\n'
               || E'      update public.lancamentos_financeiros set extrato_linha_id = null where extrato_linha_id = r_linha.id;\n'
               || E'      for d in select value from jsonb_array_elements(coalesce(r_linha.desfazer->''datas'', ''[]''::jsonb)) loop\n'
               || E'        if exists (select 1 from public.lancamentos_financeiros where id = (d->>''id'')::uuid) then\n'
               || E'          perform public._mudar_data_do_lancamento((d->>''id'')::uuid, (d->>''de'')::date);\n'
               || E'        end if;\n'
               || E'      end loop;\n'
               || E'      update public.extrato_linhas\n'
               || E'         set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,\n'
               || E'             grupo = null, resolvida_sozinha = null, sem_auto = true\n'
               || E'       where id = r_linha.id;\n'
               || E'      continue;\n'
               || E'    end if;\n\n';
begin
  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'desfazer_conciliacao não está como esperado: o trecho da linha do histórico não foi achado uma vez só.';
  end if;
  execute replace(v_def, v_ancora, v_novo || v_ancora);
end
$migration$;

-- 4 ------------------------------------------------------------------------------
create or replace function public.lancamento_desliga_a_linha()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_linha extrato_linhas%rowtype;
begin
  select * into v_linha from public.extrato_linhas where id = old.extrato_linha_id;
  if v_linha.conciliada_como = 'conjunto' and v_linha.grupo is not null then
    update public.lancamentos_financeiros
       set extrato_linha_id = null
     where extrato_linha_id in (select id from public.extrato_linhas where grupo = v_linha.grupo)
       and id <> old.id;
    update public.extrato_linhas
       set sem_auto = true,
           resolvida_sozinha = null,
           conciliada_como = null,
           conciliada_em = null,
           conciliada_por = null,
           desfazer = null,
           grupo = null
     where grupo = v_linha.grupo;
    return old;
  end if;

  -- A linha mista (decisão 281): a planilha e os pares saem junto.
  if v_linha.conciliada_como = 'misto' then
    delete from public.historico_movimento_baixas b
     using jsonb_array_elements(coalesce(v_linha.desfazer->'pares', '[]'::jsonb)) x
     where b.historico_movimento_id = (x->>'historico_movimento_id')::uuid
       and b.lancamento_id = (x->>'lancamento_id')::uuid;
    update public.historico_movimentos set extrato_linha_id = null where extrato_linha_id = old.extrato_linha_id;
  end if;

  update public.lancamentos_financeiros
     set extrato_linha_id = null
   where extrato_linha_id = old.extrato_linha_id
     and id <> old.id;
  update public.extrato_linhas
     set sem_auto = true,
         resolvida_sozinha = null,
         conciliada_como = null,
         conciliada_em = null,
         conciliada_por = null,
         desfazer = null,
         grupo = null
   where id = old.extrato_linha_id;
  return old;
end;
$function$;

-- 5 ------------------------------------------------------------------------------
create or replace function public._historico_apagar_linhas(p_cargas uuid[])
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  -- A linha mista (decisão 281) que perde a planilha solta também os lançamentos.
  update public.lancamentos_financeiros
     set extrato_linha_id = null
   where extrato_linha_id in (select e.id from public.extrato_linhas e
                               where e.conciliada_como = 'misto'
                                 and e.id in (select extrato_linha_id from public.historico_movimentos
                                               where carga_id = any(p_cargas) and extrato_linha_id is not null));
  update public.extrato_linhas
     set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,
         grupo = null, resolvida_sozinha = null, avaliada_em = null
   where id in (select extrato_linha_id from public.historico_movimentos
                 where carga_id = any(p_cargas) and extrato_linha_id is not null);
  delete from public.historico_movimentos where carga_id = any(p_cargas);
  delete from public.historico_notas where carga_id = any(p_cargas);
  delete from public.historico_jobs where carga_id = any(p_cargas);
  delete from public.historico_rateio_regional where carga_id = any(p_cargas);
  delete from public.historico_saldos where carga_id = any(p_cargas);
$function$;
