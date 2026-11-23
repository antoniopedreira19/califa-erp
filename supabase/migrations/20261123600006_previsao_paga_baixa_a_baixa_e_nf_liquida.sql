-- A previsão paga casada baixa a baixa, a ligação da previsão de outro dia e a
-- NF 6116 (revisão da decisão 270, 23/11/2026; continuação da 600004/600005).
--
-- O que ficou de fora com a regra da 600004 (mesma conta, dia e valor da
-- LINHA do banco), na California Santander:
-- - o PIX que pagou várias PPs: a linha do banco tem várias baixas e a
--   planilha uma linha por PP (21 linhas do banco, 69 baixas, −267.750,67);
-- - os custos fixos pagos juntos (5 linhas do banco, 13 baixas, −195.353,76);
-- - a NF recebida líquida com retenção, que a planilha lança pelo bruto e por
--   uma linha por imposto retido, em outro dia: a NF 6116, 6 linhas de 13/11
--   (+511.038,00 e −56.980,74 de ISS, COFINS, IRPJ, CSLL e PIS) para a baixa de
--   16/11 (+454.057,26, com as mesmas retenções). Até 23/11 as 6 linhas estavam
--   ligadas à linha do banco; a conciliação passou a linha para a baixa e elas
--   saíram do DRE (aviso da sessão da conciliação).
--
-- 1. `_historico_previsoes_pagas`: depois do casamento pela linha do banco
--    (b1), casa baixa a baixa (b2): a previsão de mesma conta, do dia da linha
--    do banco e do valor de uma das baixas dela, uma a uma. Nada é gravado.
-- 2. `ligar_baixa_ao_historico` aceita também a baixa a partir do início da
--    conta, já conciliada com o banco: liga previsões da planilha da mesma
--    conta, de qualquer dia, quando somam o valor das baixas (o caso da NF
--    líquida). Continua valendo a regra de antes para a baixa antes do início.
-- 3. A NF 6116: as 6 linhas ligadas à baixa (a regra (a) as conta).

-- 1. ---------------------------------------------------------------------------
create or replace function public._historico_previsoes_pagas(p_tenant_id uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with prev as (
    -- As previsões ainda soltas: sem linha do banco e sem ligação.
    select m.id, m.conta_bancaria_id, m.data, m.valor, m.aba, m.linha
      from public.historico_movimentos m
      join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
     where (p_tenant_id is null or m.tenant_id = p_tenant_id)
       and m.extrato_linha_id is null
       and m.valor <> 0
       and not exists (select 1 from public.historico_movimento_baixas hb where hb.historico_movimento_id = m.id)
  ), banco as (
    -- As linhas do banco conciliadas só com lançamentos do sistema.
    select e.id, e.conta_bancaria_id, e.data, e.valor
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
  ), b1 as (
    -- Pela linha do banco: mesma conta, dia e valor, uma a uma.
    select p.id as prev_id, b.id as banco_id
      from (select prev.*, row_number() over (partition by conta_bancaria_id, data, valor order by aba, linha, id) as k from prev) p
      join (select banco.*, row_number() over (partition by conta_bancaria_id, data, valor order by id) as k from banco) b
        on b.conta_bancaria_id = p.conta_bancaria_id and b.data = p.data and b.valor = p.valor and b.k = p.k
  ), lanc as (
    -- As baixas das linhas do banco que não casaram inteiras.
    select l.id, b.conta_bancaria_id, b.data,
           case when l.natureza = 'entrada' then l.valor else -l.valor end as v
      from banco b
      join public.lancamentos_financeiros l on l.extrato_linha_id = b.id
     where b.id not in (select banco_id from b1)
  ), b2 as (
    -- Baixa a baixa: mesma conta, dia da linha do banco e valor da baixa.
    select p.id as prev_id
      from (select prev.*, row_number() over (partition by conta_bancaria_id, data, valor order by aba, linha, id) as k
              from prev where prev.id not in (select prev_id from b1)) p
      join (select lanc.*, row_number() over (partition by conta_bancaria_id, data, v order by id) as k from lanc) x
        on x.conta_bancaria_id = p.conta_bancaria_id and x.data = p.data and x.v = p.valor and x.k = p.k
  )
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
  select prev_id from b1
  union
  select prev_id from b2;
$function$;

revoke all on function public._historico_previsoes_pagas(uuid) from public, anon, authenticated;

comment on function public._historico_previsoes_pagas(uuid) is
  'Revisão da decisão 270 (23/11/2026): as previsões da planilha já pagas por baixa do sistema conciliada com o banco: ligadas em historico_movimento_baixas; ou de mesma conta, dia e valor da linha do banco (uma a uma); ou, na linha do banco com várias baixas, de mesma conta, dia e valor de uma das baixas. Lida pelos relatórios do histórico e pela vw_fluxo_caixa (null = todos os tenants); nada é gravado.';

-- 2. ---------------------------------------------------------------------------
create or replace function public.ligar_baixa_ao_historico(p_lancamento_ids uuid[], p_movimento_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant     uuid;
  v_uid        uuid;
  v_n          integer;
  v_contas     integer;
  v_datas      integer;
  v_conta      uuid;
  v_data       date;
  v_inicio     date;
  v_antes      integer;
  v_no_banco   integer;
  v_baixas     numeric;
  v_linhas     numeric;
begin
  if coalesce(cardinality(p_lancamento_ids), 0) = 0 then
    raise exception 'Escolha as baixas que a linha da planilha registra.';
  end if;
  if coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha as linhas da planilha que registram este pagamento.';
  end if;

  perform 1 from public.lancamentos_financeiros where id = any (p_lancamento_ids) for update;
  select (array_agg(tenant_id))[1] into v_tenant
    from public.lancamentos_financeiros where id = any (p_lancamento_ids);
  if v_tenant is null then raise exception 'Baixa não encontrada.'; end if;
  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  select count(*)::int,
         count(distinct l.conta_bancaria_id)::int,
         count(distinct l.data_movimento)::int,
         (array_agg(l.conta_bancaria_id))[1],
         min(l.data_movimento),
         count(*) filter (where l.data_movimento < cb.saldo_inicial_data)::int,
         count(*) filter (where l.extrato_linha_id is not null)::int,
         coalesce(sum(case when l.natureza = 'entrada' then l.valor else -l.valor end), 0)
    into v_n, v_contas, v_datas, v_conta, v_data, v_antes, v_no_banco, v_baixas
    from public.lancamentos_financeiros l
    join public.contas_bancarias cb on cb.id = l.conta_bancaria_id
   where l.id = any (p_lancamento_ids)
     and l.tenant_id = v_tenant
     and l.estorno_de_lancamento_id is null
     and not exists (select 1 from public.historico_movimento_baixas b where b.lancamento_id = l.id);
  if v_n <> (select count(distinct x) from unnest(p_lancamento_ids) x) then
    raise exception 'Alguma baixa é estorno, não tem conta ou já está ligada à planilha: recarregue a página.';
  end if;
  if v_contas <> 1 then
    raise exception 'As baixas precisam ser da mesma conta.';
  end if;

  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;

  if v_antes = v_n then
    -- Antes do início da conta: linhas do período, da cauda ou do só DRE, do
    -- mesmo dia das baixas, sem linha do banco.
    if v_datas <> 1 then
      raise exception 'As baixas precisam ser do mesmo dia.';
    end if;
    if v_no_banco > 0 then
      raise exception 'Alguma baixa já está ligada ao banco: recarregue a página.';
    end if;
    select count(*)::int, coalesce(sum(h.valor), 0)
      into v_n, v_linhas
      from public.historico_movimentos h
      join public.historico_cargas c on c.id = h.carga_id
     where h.id = any (p_movimento_ids)
       and h.tenant_id = v_tenant
       and c.situacao = 'ativa'
       and c.tipo in ('periodo', 'cauda', 'so_dre')
       and h.extrato_linha_id is null
       and h.conta_bancaria_id = v_conta
       and h.data = v_data
       and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
    if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
      raise exception 'Alguma linha não é da mesma conta e do mesmo dia das baixas, não é de carga ativa ou já está ligada: recarregue a página.';
    end if;
  elsif v_antes = 0 then
    -- A partir do início da conta: a baixa já conciliada com o banco e as
    -- previsões da planilha do mesmo pagamento, de qualquer dia (a NF
    -- recebida líquida, que a planilha lança pelo bruto e pelas retenções).
    if v_no_banco <> v_n then
      raise exception 'A partir de % a baixa só se liga à planilha depois de conciliada com o banco.',
        to_char((select saldo_inicial_data from public.contas_bancarias where id = v_conta), 'DD/MM/YYYY');
    end if;
    select count(*)::int, coalesce(sum(h.valor), 0)
      into v_n, v_linhas
      from public.historico_movimentos h
      join public.historico_cargas c on c.id = h.carga_id
     where h.id = any (p_movimento_ids)
       and h.tenant_id = v_tenant
       and c.situacao = 'ativa'
       and c.tipo = 'previsao'
       and h.extrato_linha_id is null
       and h.conta_bancaria_id = v_conta
       and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
    if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
      raise exception 'Alguma linha não é previsão da planilha da mesma conta, já está ligada ao banco ou já está ligada a uma baixa: recarregue a página.';
    end if;
  else
    raise exception 'As baixas precisam estar todas antes ou todas depois do início da conta.';
  end if;

  if abs(v_linhas - v_baixas) >= 0.005 then
    raise exception 'As linhas da planilha somam % e as baixas, %: confira as linhas ou os valores das baixas.',
      public._moeda_br(abs(v_linhas)), public._moeda_br(abs(v_baixas));
  end if;

  insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, ligado_por)
  select distinct m.id, l.id, v_tenant, v_uid
    from unnest(p_movimento_ids) as m(id)
   cross join unnest(p_lancamento_ids) as l(id);
end;
$function$;

revoke all on function public.ligar_baixa_ao_historico(uuid[], uuid[]) from public, anon;
grant execute on function public.ligar_baixa_ao_historico(uuid[], uuid[]) to authenticated;

comment on function public.ligar_baixa_ao_historico(uuid[], uuid[]) is
  'Decisão 270: a conciliação do histórico. Antes do início da conta: liga baixas às linhas da planilha (período, cauda, só DRE) da mesma conta e do mesmo dia. A partir do início: liga baixas já conciliadas com o banco às previsões da planilha da mesma conta, de qualquer dia. Nos dois casos as somas precisam bater.';

-- 3. ---------------------------------------------------------------------------
-- A NF 6116 (California Santander): as 6 linhas da planilha de 13/11 e a baixa
-- de 16/11. Só liga se tudo estiver como em 23/11 (sem efeito em outra base).
do $$
declare
  v_baixa  constant uuid := 'baf4a7c7-40fa-4ac1-9a3a-3605e70bdd5e';
  v_linhas constant uuid[] := array[
    '68f89f60-4f1d-44a6-b8ff-d80663eeacdd',  -- +511.038,00 recebimento (bruto)
    '0ccba3ec-5190-4430-a7de-2c8291487f78',  -- −25.551,90 ISS
    '8d25a7d5-b2ce-4c64-bae6-fa9d6b65f676',  -- −15.331,14 COFINS
    '0b9529d5-e3a9-4e17-bd49-32433109a34b',  -- −7.665,57 IRPJ
    'e0aca8ee-3b42-4b24-98b7-72917e549b3e',  -- −5.110,38 CSLL
    '6f0b5022-f988-425e-8f82-fc187825545c'   -- −3.321,75 PIS
  ]::uuid[];
  v_lanc   public.lancamentos_financeiros%rowtype;
  v_soma   numeric;
  v_n      integer;
begin
  select * into v_lanc from public.lancamentos_financeiros where id = v_baixa;
  if not found or v_lanc.extrato_linha_id is null then
    raise notice 'NF 6116: baixa não encontrada ou sem linha do banco; nada ligado.';
    return;
  end if;
  select count(*), coalesce(sum(h.valor), 0) into v_n, v_soma
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
   where h.id = any (v_linhas)
     and h.conta_bancaria_id = v_lanc.conta_bancaria_id
     and h.extrato_linha_id is null
     and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
  if v_n <> 6 or abs(v_soma - v_lanc.valor) >= 0.005 then
    raise notice 'NF 6116: linhas em outro estado (% de 6, soma %); nada ligado.', v_n, v_soma;
    return;
  end if;
  insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id)
  select x, v_baixa, v_lanc.tenant_id from unnest(v_linhas) x
  on conflict do nothing;
end;
$$;
