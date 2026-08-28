-- Fechar a fatura do cartão.
--
-- Fatia 3, passo 3 de 4 — o momento em que a fatura vira contabilidade.
--
-- É AQUI que os lançamentos por item nascem, e não na compra. A escolha é
-- deliberada: enquanto a fatura está aberta, o time ainda vai remanejar
-- item que caiu no cartão errado e lançar compra que ninguém registrou.
-- Com os lançamentos já escritos, cada correção viraria um
-- contra-lançamento no razão. Escrevendo no fechamento, o razão nasce
-- certo de primeira.
--
-- Cada item vira UM lançamento na conta do cartão, com o SEU plano de
-- contas — é isso que preserva a granularidade no DRE. A alternativa (um
-- lançamento só, para a fatura toda) faria a assinatura, o fornecedor e o
-- material de escritório virarem uma linha indistinta.
--
-- A DIFERENÇA entre a soma dos itens e o que o banco cobrou vira um
-- lançamento de ajuste, com plano de contas próprio. É o IOF, a anuidade,
-- o juro — coisas que ninguém lança e que existem toda fatura. Sem isso, a
-- fatura nunca fecharia com o extrato.

create or replace function public.fechar_fatura_cartao(
  p_fatura_id uuid,
  p_valor_cobrado numeric,
  p_ajuste_tipo_id uuid default null,
  p_ajuste_subtipo_id uuid default null,
  p_ajuste_descricao text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid  uuid;
  v_fatura      faturas_cartao%rowtype;
  v_cartao      cartoes_credito%rowtype;
  v_conta_id    uuid;
  v_item        record;
  v_soma        numeric := 0;
  v_diferenca   numeric;
  v_subtipo_tipo uuid;
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

  if p_valor_cobrado is null or p_valor_cobrado <= 0 then
    raise exception 'Informe o valor cobrado pelo banco nesta fatura.';
  end if;

  select * into v_cartao from cartoes_credito where id = v_fatura.cartao_credito_id;

  select id into v_conta_id
    from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if v_conta_id is null then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  -- ---- Um lançamento por item, com o plano de contas DELE ----
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
      forma_pagamento, cartao_credito_id, fatura_cartao_id,
      origem, criado_por
    ) values (
      v_item.tenant_id, v_item.empresa_id, v_conta_id,
      v_fatura.competencia_fechamento, v_item.valor,
      v_item.natureza, 'Cartão · ' || substring(v_item.descricao, 1, 180),
      v_item.plano_conta_tipo_id, v_item.plano_conta_subtipo_id,
      v_item.fornecedor_id, v_item.cliente_id, v_item.job_id, v_item.id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id,
      'avulsa_baixa', v_caller_uid
    );

    -- O item foi pago — pela administradora do cartão, não pelo banco.
    update contas_avulsas
       set status = 'baixada',
           pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid,
           conta_bancaria_baixa_id = v_conta_id
     where id = v_item.id;

    v_soma := v_soma + v_item.valor;
  end loop;

  -- ---- A diferença ----
  v_diferenca := p_valor_cobrado - v_soma;

  if abs(v_diferenca) > 0.005 then
    if p_ajuste_tipo_id is null or p_ajuste_subtipo_id is null then
      raise exception
        'A fatura fecha em % e o banco cobrou % — diferença de %. Informe o plano de contas do ajuste (IOF, anuidade, juros) ou lance o que está faltando antes de fechar.',
        to_char(v_soma, 'FM999999999990.00'),
        to_char(p_valor_cobrado, 'FM999999999990.00'),
        to_char(v_diferenca, 'FM999999999990.00');
    end if;

    select tipo_id into v_subtipo_tipo
      from plano_contas_subtipos where id = p_ajuste_subtipo_id;
    if not found then raise exception 'Subtipo do ajuste não encontrado.'; end if;
    if v_subtipo_tipo <> p_ajuste_tipo_id then
      raise exception 'Subtipo do ajuste não pertence ao tipo escolhido.';
    end if;

    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id,
      origem, criado_por
    ) values (
      v_fatura.tenant_id, v_cartao.empresa_id, v_conta_id,
      v_fatura.competencia_fechamento, abs(v_diferenca),
      case when v_diferenca > 0 then 'saida' else 'entrada' end,
      coalesce(
        nullif(btrim(p_ajuste_descricao), ''),
        'Ajuste da fatura ' || v_fatura.codigo
      ),
      p_ajuste_tipo_id, p_ajuste_subtipo_id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id,
      'manual', v_caller_uid
    );
  end if;

  update faturas_cartao
     set status = 'fechada',
         valor_cobrado = p_valor_cobrado,
         fechada_em = now(),
         fechada_por = v_caller_uid
   where id = p_fatura_id;

  return p_fatura_id;
end;
$function$;

revoke execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) from public;
grant execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) to authenticated;
