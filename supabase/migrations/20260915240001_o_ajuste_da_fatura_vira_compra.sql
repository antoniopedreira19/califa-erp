-- O ajuste da fatura do cartão vira compra da fatura (decisão 084).
--
-- O problema: a diferença entre a soma das compras e o valor que o banco
-- cobrou nascia como um lançamento solto (`papel_na_fatura = 'ajuste'`,
-- origem 'manual'), SEM regional. Toda fatura tem IOF, anuidade ou juro,
-- então todo mês entrava no DRE uma despesa que nenhuma regional pagava.
-- E lançamento não tem para onde ratear: rateio só existe para avulsa,
-- recorrente e desembolso — a coluna `regional_id` do lançamento comporta
-- uma regional só.
--
-- A saída: a diferença passa a nascer como CONTA AVULSA do cartão, igual
-- a qualquer compra. Com isso ela herda, sem código novo, o rateio
-- (`contas_avulsas_regionais`), a trava de soma 100, a lista de itens da
-- fatura, a conciliação e o DRE por plano de contas.
--
-- E ela pode ser VÁRIAS: quando o que faltou foram duas compras que
-- ninguém lançou, cada uma entra com a sua descrição, o seu plano de
-- contas e o seu rateio. Querendo um ajuste só, é o mesmo caminho com uma
-- linha (pedido do Tiago em 15/09/2026).
--
-- Ordem dentro do fechamento: as compras do ajuste nascem ANTES do laço
-- que transforma item em lançamento. Assim elas entram por ele, como
-- qualquer outra compra, e a fatura fecha bang-on no valor cobrado — sem
-- um segundo caminho para manter.
--
-- Esta migration ACRESCENTA a assinatura nova (p_ajustes jsonb) ao lado da
-- antiga. A antiga sai numa migration própria, depois que o código que
-- chama a nova estiver no ar — foi o que faltou em 08/09/2026, quando a
-- trava chegou antes do código e derrubou seis fluxos.

-- ---------------------------------------------------------------------
-- 1) O rateio proporcional às compras da fatura
-- ---------------------------------------------------------------------
-- É o padrão que o fechamento oferece: o IOF da fatura se divide entre as
-- regionais na mesma proporção em que elas gastaram nela. A base soma os
-- dois tipos de item — a compra avulsa, pelo rateio dela, e a parcela de
-- PP, pela regional do job (decisão 069). Estorno é 'entrada' e ABATE.
--
-- A sobra de centavo vai para as maiores frações (maior resto), porque a
-- trava do banco exige soma exatamente 100,00.
create or replace function public.rateio_proporcional_da_fatura(p_fatura_id uuid)
returns table (regional_id uuid, percentual numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select ar.regional_id,
           sum((case when a.natureza = 'entrada' then -a.valor else a.valor end)
               * ar.percentual / 100.0) as peso
      from contas_avulsas a
      join contas_avulsas_regionais ar on ar.conta_avulsa_id = a.id
     where a.fatura_cartao_id = p_fatura_id
       and a.status in ('aprovada', 'baixada')
     group by ar.regional_id
    union all
    select j.regional_id, sum(par.valor) as peso
      from pedidos_compra_parcelas par
      join pedidos_compra pc on pc.id = par.pedido_compra_id
      join jobs j on j.id = pc.job_id
     where par.fatura_cartao_id = p_fatura_id
     group by j.regional_id
  ),
  somado as (
    select b.regional_id, sum(b.peso) as peso
      from base b
     group by b.regional_id
    having sum(b.peso) > 0
  ),
  total as (
    select sum(s.peso) as peso from somado s
  ),
  piso as (
    select s.regional_id,
           floor(s.peso * 10000.0 / t.peso) / 100.0 as pct,
           row_number() over (
             order by (s.peso * 10000.0 / t.peso) - floor(s.peso * 10000.0 / t.peso) desc,
                      s.regional_id
           ) as ordem
      from somado s
     cross join total t
     where t.peso > 0
  ),
  centavos as (
    select round((100 - sum(p.pct)) * 100)::int as faltam from piso p
  )
  select p.regional_id,
         (p.pct + case when p.ordem <= (select c.faltam from centavos c)
                       then 0.01 else 0 end)::numeric as percentual
    from piso p
   where p.pct + case when p.ordem <= (select c.faltam from centavos c)
                      then 0.01 else 0 end > 0
   order by 2 desc, 1;
$$;

comment on function public.rateio_proporcional_da_fatura(uuid) is
  'Decisão 084: como as regionais dividiram os gastos desta fatura. É o rateio que o fechamento sugere para o ajuste. Vazio quando a fatura não tem nenhum item com regional — aí o fechamento pergunta.';

revoke all on function public.rateio_proporcional_da_fatura(uuid) from public;
grant execute on function public.rateio_proporcional_da_fatura(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) O fechamento, com a diferença virando uma ou mais compras
-- ---------------------------------------------------------------------
create or replace function public.fechar_fatura_cartao(
  p_fatura_id     uuid,
  p_valor_cobrado numeric,
  p_ajustes       jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid   uuid;
  v_fatura       faturas_cartao%rowtype;
  v_conta        contas_bancarias%rowtype;
  v_item         record;
  v_pp           record;
  v_aj           record;
  v_em_aberto    integer;
  v_soma         numeric := 0;
  v_prevista     numeric := 0;
  v_diferenca    numeric;
  v_ajustado     numeric := 0;
  v_subtipo_tipo uuid;
  v_avulsa_id    uuid;
  v_quantos      integer := 0;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status <> 'aberta' then
    raise exception 'Só fatura aberta pode ser fechada (status atual: %).', v_fatura.status;
  end if;

  if p_valor_cobrado is null then
    raise exception 'Informe o valor cobrado pelo banco nesta fatura.';
  end if;

  select * into v_conta from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  -- ------------------------------------------------------------------
  -- Quanto a fatura soma ANTES de qualquer ajuste.
  -- ------------------------------------------------------------------
  select coalesce(sum(case when a.natureza = 'entrada' then -a.valor else a.valor end), 0)
    into v_prevista
    from contas_avulsas a
   where a.fatura_cartao_id = p_fatura_id
     and a.status = 'aprovada';

  v_prevista := v_prevista + coalesce((
    select sum(par.valor)
      from pedidos_compra_parcelas par
     where par.fatura_cartao_id = p_fatura_id
       and par.pago_em is null
  ), 0);

  v_diferenca := p_valor_cobrado - v_prevista;

  -- ------------------------------------------------------------------
  -- A diferença vira compra — uma ou várias, cada uma com o seu rateio.
  -- ------------------------------------------------------------------
  if abs(v_diferenca) > 0.005 then
    if p_ajustes is null
       or jsonb_typeof(p_ajustes) <> 'array'
       or jsonb_array_length(p_ajustes) = 0 then
      raise exception
        'A fatura fecha em % e o banco cobrou % — diferença de %. Registre o que falta (IOF, anuidade, juros ou compra que ninguém lançou) antes de fechar.',
        to_char(v_prevista, 'FM999999999990.00'),
        to_char(p_valor_cobrado, 'FM999999999990.00'),
        to_char(v_diferenca, 'FM999999999990.00');
    end if;

    -- Diferença para baixo é crédito no cartão, e crédito no cartão só
    -- existe como estorno de uma compra — é o que `chk_avulsa_credito_no
    -- _cartao_e_estorno` garante desde 29/08/2026. Registrar isso como
    -- "ajuste" solto perderia de qual compra o dinheiro voltou.
    if v_diferenca < 0 then
      raise exception
        'O banco cobrou % e as compras somam % — % a menos. Diferença para baixo é estorno: registre o estorno da compra correspondente (botão Estornar, na compra) e feche de novo.',
        to_char(p_valor_cobrado, 'FM999999999990.00'),
        to_char(v_prevista, 'FM999999999990.00'),
        to_char(abs(v_diferenca), 'FM999999999990.00');
    end if;

    for v_aj in
      select x.descricao, x.tipo_id, x.subtipo_id, x.valor, x.rateio
        from jsonb_to_recordset(p_ajustes)
          as x(descricao text, tipo_id uuid, subtipo_id uuid, valor numeric, rateio jsonb)
    loop
      v_quantos := v_quantos + 1;

      if v_aj.valor is null or v_aj.valor <= 0 then
        raise exception 'O item % do ajuste precisa de um valor maior que zero.', v_quantos;
      end if;

      if v_aj.tipo_id is null or v_aj.subtipo_id is null then
        raise exception 'O item % do ajuste precisa de tipo e subtipo do plano de contas.', v_quantos;
      end if;

      select s.tipo_id into v_subtipo_tipo
        from plano_contas_subtipos s where s.id = v_aj.subtipo_id;
      if not found then
        raise exception 'Subtipo do item % do ajuste não encontrado.', v_quantos;
      end if;
      if v_subtipo_tipo <> v_aj.tipo_id then
        raise exception 'Subtipo do item % do ajuste não pertence ao tipo escolhido.', v_quantos;
      end if;

      -- Nasce como qualquer compra do cartão. `criar_conta_avulsa` recusa
      -- sem rateio, e a soma 100 é conferida no commit — as duas travas da
      -- decisão 082 valem aqui sem uma linha a mais.
      --
      -- `data_compra` é a competência desta fatura: é ela que o gatilho
      -- `avulsa_entra_na_fatura` usa para escolher a fatura, e a fatura
      -- ainda está aberta neste ponto. A compra nasce aqui dentro.
      v_avulsa_id := public.criar_conta_avulsa(
        jsonb_build_object(
          'tenant_id', v_fatura.tenant_id,
          'codigo', public.gerar_codigo_avulsa(v_fatura.tenant_id),
          'empresa_id', v_conta.empresa_id,
          'descricao', coalesce(nullif(btrim(v_aj.descricao), ''),
                                'Ajuste da fatura ' || v_fatura.codigo),
          'valor', v_aj.valor,
          'natureza', 'saida',
          'plano_conta_tipo_id', v_aj.tipo_id,
          'plano_conta_subtipo_id', v_aj.subtipo_id,
          'forma_pagamento', 'cartao_credito',
          'cartao_credito_id', v_fatura.cartao_credito_id,
          'data_compra', v_fatura.competencia_fechamento,
          'criado_por', v_caller_uid,
          'aprovada_em', now(),
          'aprovada_por', v_caller_uid
        ),
        coalesce(v_aj.rateio, '[]'::jsonb)
      );

      -- Cinto de segurança: se o gatilho mandasse a compra para a fatura
      -- seguinte, a diferença voltaria a aparecer no mês que vem.
      if (select a.fatura_cartao_id from contas_avulsas a where a.id = v_avulsa_id)
         is distinct from p_fatura_id then
        raise exception 'O item % do ajuste não entrou nesta fatura. Avise o suporte.', v_quantos;
      end if;

      v_ajustado := v_ajustado + v_aj.valor;
    end loop;

    if abs(v_ajustado - v_diferenca) > 0.005 then
      raise exception
        'Os itens do ajuste somam % e a diferença é %. Os valores precisam fechar a diferença exatamente.',
        to_char(v_ajustado, 'FM999999999990.00'),
        to_char(v_diferenca, 'FM999999999990.00');
    end if;

  elsif p_ajustes is not null
        and jsonb_typeof(p_ajustes) = 'array'
        and jsonb_array_length(p_ajustes) > 0 then
    raise exception
      'A fatura já fecha no valor cobrado (%) — não há diferença para registrar.',
      to_char(p_valor_cobrado, 'FM999999999990.00');
  end if;

  -- ------------------------------------------------------------------
  -- Cada item vira lançamento na conta do cartão, com o plano de contas
  -- dele. Os ajustes recém-criados entram por aqui, como compras.
  -- ------------------------------------------------------------------
  for v_item in
    select a.*
      from contas_avulsas a
     where a.fatura_cartao_id = p_fatura_id
       and a.status = 'aprovada'
     order by a.data_prevista_pagamento, a.created_at
  loop
    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, cliente_id, job_id, conta_avulsa_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      origem, criado_por
    ) values (
      v_item.tenant_id, v_item.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, v_item.valor,
      v_item.natureza,
      case when v_item.estorno_de_avulsa_id is not null
           then 'Estorno · ' else 'Cartão · ' end
        || substring(v_item.descricao, 1, 180),
      v_item.plano_conta_tipo_id, v_item.plano_conta_subtipo_id,
      v_item.fornecedor_id, v_item.cliente_id, v_item.job_id, v_item.id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id, 'item',
      'avulsa_baixa', v_caller_uid
    );

    update contas_avulsas
       set status = 'baixada',
           pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid,
           conta_bancaria_baixa_id = v_conta.id
     where id = v_item.id;

    v_soma := v_soma
      + case when v_item.natureza = 'entrada' then -v_item.valor else v_item.valor end;
  end loop;

  for v_pp in
    select par.id      as parcela_id,
           par.numero  as parcela_numero,
           par.valor   as parcela_valor,
           pc.id       as pp_id,
           pc.codigo   as pp_codigo,
           pc.servico  as pp_servico,
           pc.tenant_id, pc.empresa_id, pc.fornecedor_id, pc.job_id,
           pc.plano_conta_tipo_id, pc.plano_conta_subtipo_id,
           (select count(*) from pedidos_compra_parcelas x
             where x.pedido_compra_id = pc.id) as total_parcelas
      from pedidos_compra_parcelas par
      join pedidos_compra pc on pc.id = par.pedido_compra_id
     where par.fatura_cartao_id = p_fatura_id
       and par.pago_em is null
     order by pc.codigo, par.numero
  loop
    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      origem, criado_por
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, v_pp.parcela_valor,
      'saida',
      'Cartão · PP ' || v_pp.pp_codigo || ' '
        || v_pp.parcela_numero || '/' || v_pp.total_parcelas
        || ' — ' || substring(v_pp.pp_servico, 1, 140),
      v_pp.plano_conta_tipo_id, v_pp.plano_conta_subtipo_id,
      v_pp.fornecedor_id, v_pp.job_id, v_pp.pp_id, v_pp.parcela_id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id, 'item',
      'pp_baixa', v_caller_uid
    );

    update pedidos_compra_parcelas
       set pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid
     where id = v_pp.parcela_id;

    select count(*)::int into v_em_aberto
      from pedidos_compra_parcelas
     where pedido_compra_id = v_pp.pp_id and pago_em is null;

    if v_em_aberto = 0 then
      update pedidos_compra
         set status = 'pago',
             pago_em = v_fatura.competencia_fechamento,
             pago_por = v_caller_uid
       where id = v_pp.pp_id;
    end if;

    v_soma := v_soma + v_pp.parcela_valor;
  end loop;

  -- Com os ajustes dentro, a soma tem que bater com o extrato. Se não
  -- bater, alguma coisa entrou ou saiu no meio do caminho: melhor não
  -- fechar do que fechar torto.
  if abs(p_valor_cobrado - v_soma) > 0.005 then
    raise exception
      'Fechamento inconsistente: os itens somam % e o banco cobrou %. Nada foi gravado.',
      to_char(v_soma, 'FM999999999990.00'),
      to_char(p_valor_cobrado, 'FM999999999990.00');
  end if;

  update faturas_cartao
     set status = 'fechada', valor_cobrado = p_valor_cobrado,
         fechada_em = now(), fechada_por = v_caller_uid
   where id = p_fatura_id;

  return p_fatura_id;
end;
$$;

comment on function public.fechar_fatura_cartao(uuid, numeric, jsonb) is
  'Decisão 084: fecha a fatura e transforma a diferença para o valor cobrado em compras da própria fatura (uma ou várias), cada uma com plano de contas e rateio de regional.';

revoke all on function public.fechar_fatura_cartao(uuid, numeric, jsonb) from public;
grant execute on function public.fechar_fatura_cartao(uuid, numeric, jsonb) to authenticated;
