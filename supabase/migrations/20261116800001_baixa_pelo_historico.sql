-- =====================================================================
-- A baixa de PP paga antes de a conta começar no sistema (decisão 261)
--
-- O CASO (16/11/2026)
-- -------------------
-- PPs do DEE-1001/26 foram pagas por fora do sistema, pela California
-- Santander, de 21/07 a 08/10/2026. A conta começa no sistema em 03/11
-- (`saldo_inicial_data`), e toda baixa passa por `_conta_da_baixa`, que
-- recusa data anterior a ela. O pagamento já está no histórico da planilha
-- (cargas de período e "só DRE"), na data certa.
--
-- O QUE MUDA
-- ----------
-- 1. `historico_movimentos.lancamento_id`: a linha da planilha passa a dizer
--    qual baixa do sistema ela é. Cancelar a baixa apaga o lançamento, e a
--    ligação cai junto (on delete set null).
-- 2. `baixar_parcela_pp_pelo_historico`: baixa a parcela na data e na conta
--    das linhas do histórico, pelo valor inteiro que falta, e liga as linhas.
--    Só para data ANTERIOR ao saldo inicial da conta: a partir dele, o
--    pagamento se baixa pela conciliação com o banco.
-- 3. `_conta_da_baixa`: aceita a data anterior ao saldo inicial só quando a
--    função do item 2 a liberou, nesta transação, para aquela conta e
--    aquele dia (`app.baixa_pelo_historico`). Toda outra baixa continua
--    barrada como antes.
-- 4. `historico_extrato_da_conta`: cada linha traz a baixa ligada e o
--    código da PP, para o Extrato mostrar a PP na linha do histórico e não
--    repetir a baixa na parte do sistema.
--
-- O QUE NÃO MUDA: o saldo e a conciliação
-- ---------------------------------------
-- O lançamento nasce com a data do pagamento, antes do saldo inicial. O
-- saldo da conta (`fc_saldos_por_conta`, `calcularSaldoAnterior`), as
-- condições do fechamento (`_condicoes_do_fechamento`) e a conciliação dia
-- a dia contam só a partir de `saldo_inicial_data`, então nenhum deles se
-- move. A linha da planilha não muda de carga nem de valor: o DRE do
-- histórico segue igual.
--
-- Aditiva: coluna nova anulável, função nova, e duas funções que só
-- ganham um caminho (a trava de data continua igual para todo o resto).
-- =====================================================================

-- ---------- 1. A ligação da linha da planilha com a baixa ----------
alter table public.historico_movimentos
  add column if not exists lancamento_id uuid
    references public.lancamentos_financeiros(id) on delete set null;

create index if not exists idx_historico_movimentos_lancamento
  on public.historico_movimentos (lancamento_id)
  where lancamento_id is not null;

comment on column public.historico_movimentos.lancamento_id is
  'Decisão 261: a baixa do sistema que esta linha da planilha registra. Só se liga pela baixa de pagamento anterior ao saldo inicial da conta (baixar_parcela_pp_pelo_historico). Cancelar a baixa desliga.';

-- ---------- 2. A trava da data, com a porta da baixa pelo histórico ----------
create or replace function public._conta_da_baixa(p_conta_bancaria_id uuid, p_tenant_id uuid, p_data date, p_rotulo text)
 returns contas_bancarias
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_conta public.contas_bancarias%rowtype;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.tenant_id <> p_tenant_id then
    raise exception 'Conta bancária de outro tenant.';
  end if;
  -- Sem trava de empresa: a conta paga despesa de mais de uma empresa
  -- (29/08/2026). Quem diz a empresa é o documento.
  if v_conta.cartao_credito_id is not null then
    raise exception 'A conta espelho de um cartão não paga título direto — escolha a forma \"cartão de crédito\".';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  -- Decisão 261: a data anterior ao saldo inicial só passa quando a baixa
  -- pelo histórico a liberou, nesta transação, para esta conta e este dia.
  if p_data < v_conta.saldo_inicial_data
     and coalesce(current_setting('app.baixa_pelo_historico', true), '')
         <> (v_conta.id::text || '|' || p_data::text) then
    raise exception 'Data do % é anterior à data do saldo inicial da conta.', p_rotulo;
  end if;
  return v_conta;
end;
$function$;

-- ---------- 3. A baixa da parcela pela linha do histórico ----------
create or replace function public.baixar_parcela_pp_pelo_historico(
  p_parcela_id uuid,
  p_movimento_ids uuid[],
  p_tipo_id uuid,
  p_subtipo_id uuid,
  p_forma_pagamento forma_pagamento
)
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
  if abs(-v_soma - v_aberto) >= 0.005 then
    raise exception 'As linhas do histórico somam %, e a parcela tem % a pagar: ajuste o valor da PP antes.',
      public._moeda_br(-v_soma), public._moeda_br(v_aberto);
  end if;

  -- A porta de `_conta_da_baixa`, só para esta conta e este dia, só nesta
  -- transação; fechada logo depois da baixa.
  perform set_config('app.baixa_pelo_historico', v_conta_id::text || '|' || v_data::text, true);
  v_lancamento := public.baixar_parcela_pp(
    p_parcela_id, v_data, v_conta_id, p_tipo_id, p_subtipo_id,
    p_forma_pagamento, null, v_aberto, '[]'::jsonb, 0, null
  );
  perform set_config('app.baixa_pelo_historico', '', true);

  update public.historico_movimentos
     set lancamento_id = v_lancamento
   where id = any (p_movimento_ids);

  return v_lancamento;
end;
$function$;

revoke all on function public.baixar_parcela_pp_pelo_historico(uuid, uuid[], uuid, uuid, forma_pagamento) from public, anon;
grant execute on function public.baixar_parcela_pp_pelo_historico(uuid, uuid[], uuid, uuid, forma_pagamento) to authenticated;

comment on function public.baixar_parcela_pp_pelo_historico(uuid, uuid[], uuid, uuid, forma_pagamento) is
  'Decisão 261: baixa a parcela da PP paga antes do saldo inicial da conta, na data e na conta das linhas do histórico (mesmo dia, soma = o que falta), e liga as linhas à baixa. O saldo e a conciliação não se movem: contam a partir do saldo inicial.';

-- ---------- 4. O Extrato do histórico mostra a PP da linha ----------
create or replace function public.historico_extrato_da_conta(p_conta_bancaria_id uuid, p_de date, p_ate date, p_limite integer default 3000)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_conta     public.contas_bancarias%rowtype;
  v_cargas    uuid[];
  v_primeiro  date;
  v_ultimo    date;
  v_abertura  numeric;
  v_de        date;
  v_ate       date;
  v_base      jsonb;
  v_resumo    record;
  v_linhas    jsonb;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then return null; end if;
  if not (public.is_tenant_admin(v_conta.tenant_id) or public.is_tenant_financeiro(v_conta.tenant_id)) then
    return null;
  end if;

  -- Só as cargas de período: a cauda é depois do início da conta e entra no
  -- Extrato com os lançamentos (A6).
  select coalesce(array_agg(id), '{}') into v_cargas
    from public.historico_cargas
   where tenant_id = v_conta.tenant_id and situacao = 'ativa' and tipo = 'periodo';
  select min(data), max(data) into v_primeiro, v_ultimo
    from public.historico_movimentos
   where conta_bancaria_id = v_conta.id and carga_id = any(v_cargas);

  v_base := jsonb_build_object(
    'corte', v_conta.saldo_inicial_data,
    'cobertura', case when v_primeiro is null then null
                      else jsonb_build_object('de', v_primeiro, 'ate', v_ultimo) end,
    'periodo', null);
  if v_primeiro is null then return v_base; end if;

  -- O pedaço do período no histórico: do primeiro movimento ao dia antes de a
  -- conta começar no sistema.
  v_de := greatest(p_de, v_primeiro);
  v_ate := least(p_ate, v_conta.saldo_inicial_data - 1);
  if v_de > v_ate then return v_base; end if;

  -- A abertura da carga mais antiga: o saldo da planilha no fim do mês antes dela.
  select s.saldo_planilha into v_abertura
    from public.historico_saldos s
   where s.conta_bancaria_id = v_conta.id and s.carga_id = any(v_cargas) and s.abertura
   order by s.mes
   limit 1;

  select coalesce(sum(m.valor) filter (where m.valor > 0), 0) as creditos,
         coalesce(-sum(m.valor) filter (where m.valor < 0), 0) as debitos,
         count(*) as total
    into v_resumo
    from public.historico_movimentos m
   where m.conta_bancaria_id = v_conta.id and m.carga_id = any(v_cargas)
     and m.data between v_de and v_ate;

  -- Decisão 261: a baixa ligada à linha e o código da PP dela.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'data', m.data, 'valor', m.valor, 'classe', m.classe,
           'descricao', m.descricao, 'fornecedor', m.fornecedor, 'job', m.job_nome,
           'tipo_codigo', t.codigo, 'tipo_nome', t.nome, 'subtipo_nome', s.nome,
           'competencia_trimestre', m.competencia_trimestre, 'competencia_ano', m.competencia_ano,
           'empresa', m.empresa_nome, 'regional', m.regional_nome, 'todas', m.regional_todas,
           'tipo_planilha', m.tipo_planilha, 'cod', m.cod, 'aba', m.aba, 'linha', m.linha,
           'lancamento_id', m.lancamento_id, 'pp_codigo', pc.codigo, 'pp_id', pc.id)
           order by m.data, m.linha), '[]'::jsonb)
    into v_linhas
    from (select *
            from public.historico_movimentos
           where conta_bancaria_id = v_conta.id and carga_id = any(v_cargas)
             and data between v_de and v_ate
           order by data, linha
           limit greatest(p_limite, 0)) m
    left join public.plano_contas_tipos t on t.id = m.plano_conta_tipo_id
    left join public.plano_contas_subtipos s on s.id = m.plano_conta_subtipo_id
    left join public.lancamentos_financeiros lf on lf.id = m.lancamento_id
    left join public.pedidos_compra pc on pc.id = lf.pedido_compra_id;

  return v_base || jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'saldo_anterior', coalesce(v_abertura, 0) + coalesce((
        select sum(m.valor) from public.historico_movimentos m
         where m.conta_bancaria_id = v_conta.id and m.carga_id = any(v_cargas) and m.data < v_de), 0),
    'creditos', v_resumo.creditos,
    'debitos', v_resumo.debitos,
    'total', v_resumo.total,
    'linhas', v_linhas);
end;
$function$;
