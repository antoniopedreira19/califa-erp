-- A baixa de PP pelo histórico aceita pagamento parcial (revisão da decisão
-- 261; pedido do Tiago em 17/11/2026).
--
-- O caso: a PP-00298 (R$ 31.540,00) foi paga em duas vezes antes de a conta
-- começar no sistema — R$ 15.295,00 em 01/10 e R$ 16.245,00 em 05/10, as duas
-- linhas na carga "Outubro 2026 · só DRE" — e recebeu, em 16/11, uma baixa
-- única com data 05/11, sem linha do banco: o saldo de 05/11 ficou R$ 31.540
-- abaixo do banco. O Tiago pediu a baixa nas datas da planilha, antes do
-- início, onde o ajuste de abertura absorve o pagamento.
--
-- `baixar_parcela_pp_pelo_historico` exigia que as linhas somassem exatamente
-- o que falta da parcela; com dois dias, nenhuma chamada passava. Agora a
-- soma pode ser menor ou igual ao que falta, e a baixa é desse valor (parcial
-- quando for menor). Continuam valendo: as linhas da mesma conta e do mesmo
-- dia, antes do início da conta, saídas de carga ativa e ainda sem ligação.
-- Uma chamada por dia de pagamento.

create or replace function public.baixar_parcela_pp_pelo_historico(p_parcela_id uuid, p_movimento_ids uuid[], p_tipo_id uuid, p_subtipo_id uuid, p_forma_pagamento forma_pagamento)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_parcela     pedidos_compra_parcelas%rowtype;
  v_n           integer;
  v_soma        numeric;
  v_contas      integer;
  v_datas       integer;
  v_conta_id    uuid;
  v_data        date;
  v_inicio      date;
  v_aberto      numeric;
  v_lancamento  uuid;
begin
  if coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha as linhas do histórico que pagaram esta parcela.';
  end if;
  if p_forma_pagamento is null then
    raise exception 'Informe a forma do pagamento.';
  end if;
  if p_forma_pagamento = 'cartao_credito' then
    raise exception 'O cartão não se baixa pelo histórico: o item entra na fatura.';
  end if;

  select * into v_parcela from public.pedidos_compra_parcelas where id = p_parcela_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;
  perform public._exige_financeiro_para_baixar(v_parcela.tenant_id);

  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;
  select count(*)::int,
         coalesce(sum(h.valor), 0),
         count(distinct h.conta_bancaria_id)::int,
         count(distinct h.data)::int,
         (array_agg(h.conta_bancaria_id))[1],
         min(h.data)
    into v_n, v_soma, v_contas, v_datas, v_conta_id, v_data
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id
   where h.id = any (p_movimento_ids)
     and h.tenant_id = v_parcela.tenant_id
     and c.situacao = 'ativa'
     and c.tipo in ('periodo', 'cauda', 'so_dre')
     and h.conta_bancaria_id is not null
     and h.valor < 0
     and h.lancamento_id is null
     and h.extrato_linha_id is null;
  if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
    raise exception 'Alguma linha do histórico não é uma saída de carga ativa, ou já está ligada a um pagamento: recarregue a página.';
  end if;
  if v_contas <> 1 or v_datas <> 1 then
    raise exception 'As linhas do histórico precisam ser da mesma conta e do mesmo dia.';
  end if;

  select saldo_inicial_data into v_inicio from public.contas_bancarias where id = v_conta_id;
  if v_data >= v_inicio then
    raise exception 'Pagamento a partir de % se baixa pela conciliação com o banco, não pelo histórico.',
      to_char(v_inicio, 'DD/MM/YYYY');
  end if;

  v_aberto := v_parcela.valor - public._bruto_baixado('pp_baixa', p_parcela_id);
  -- 17/11/2026: a soma pode ser menor que o que falta (pagamento em mais de um dia).
  if -v_soma - v_aberto >= 0.005 then
    raise exception 'As linhas do histórico somam %, e a parcela tem só % a pagar: ajuste o valor da PP antes.',
      public._moeda_br(-v_soma), public._moeda_br(v_aberto);
  end if;

  perform set_config('app.baixa_pelo_historico', v_conta_id::text || '|' || v_data::text, true);
  v_lancamento := public.baixar_parcela_pp(
    p_parcela_id, v_data, v_conta_id, p_tipo_id, p_subtipo_id,
    p_forma_pagamento, null, -v_soma, '[]'::jsonb, 0, null
  );
  perform set_config('app.baixa_pelo_historico', '', true);

  update public.historico_movimentos
     set lancamento_id = v_lancamento
   where id = any (p_movimento_ids);

  return v_lancamento;
end;
$function$;
