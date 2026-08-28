-- =====================================================================
-- Fatura credora não se paga — o crédito fica no cartão
--
-- Com estorno maior que as compras do mês, a fatura fecha negativa: o
-- banco não cobra nada, ele deve. Decidido em 29/08/2026 que nesse caso
-- nada desce para Títulos a Pagar; o saldo credor fica na conta do cartão
-- e abate sozinho a próxima fatura, que é o que a operadora faz.
--
-- `dar_baixa_fatura_cartao` já exigia `valor_cobrado > 0`, mas com a
-- mensagem errada ("Fatura sem valor cobrado. Feche-a informando o valor
-- do banco.") — que mandava o financeiro fechar de novo uma fatura já
-- fechada. Agora a mensagem diz o que está acontecendo.
--
-- A tela não deve nem chegar aqui: `page.tsx` só transforma em título a
-- fatura fechada com valor cobrado positivo. Esta é a rede embaixo.
-- =====================================================================

create or replace function public.dar_baixa_fatura_cartao(
  p_fatura_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid   uuid;
  v_fatura       faturas_cartao%rowtype;
  v_cartao       cartoes_credito%rowtype;
  v_conta_banco  contas_bancarias%rowtype;
  v_conta_cartao contas_bancarias%rowtype;
  v_subtipo_tipo uuid;
  v_lanc_banco   uuid;
  v_lanc_cartao  uuid;
  v_descricao    text;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status = 'paga' then
    raise exception 'Esta fatura já foi paga.';
  end if;
  if v_fatura.status <> 'fechada' then
    raise exception 'Só fatura fechada pode ser paga — a aberta ainda recebe compra (status atual: %).', v_fatura.status;
  end if;
  if v_fatura.valor_cobrado is null then
    raise exception 'Fatura sem valor cobrado. Feche-a informando o valor do banco.';
  end if;
  if v_fatura.valor_cobrado <= 0 then
    raise exception
      'A fatura % fechou em % — os estornos cobriram as compras e não há o que pagar. O crédito fica no cartão e abate a próxima fatura.',
      v_fatura.codigo,
      to_char(v_fatura.valor_cobrado, 'FM999999999990.00');
  end if;

  select * into v_cartao from cartoes_credito where id = v_fatura.cartao_credito_id;

  select * into v_conta_cartao from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  select * into v_conta_banco from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;

  if v_conta_banco.cartao_credito_id is not null then
    raise exception 'Fatura de cartão não se paga com outro cartão.';
  end if;
  if v_conta_banco.tenant_id <> v_fatura.tenant_id then
    raise exception 'Conta bancária de outro tenant.';
  end if;
  if not v_conta_banco.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta_banco.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_descricao := 'Fatura ' || v_fatura.codigo || ' · ' || v_cartao.nome;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_banco.empresa_id, p_conta_bancaria_id,
    p_pago_em, v_fatura.valor_cobrado, 'saida', v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'manual', v_caller_uid
  )
  returning id into v_lanc_banco;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_cartao.empresa_id, v_conta_cartao.id,
    p_pago_em, v_fatura.valor_cobrado, 'entrada', 'Pagamento da ' || v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'manual', v_caller_uid
  )
  returning id into v_lanc_cartao;

  update faturas_cartao set status = 'paga' where id = p_fatura_id;

  return array[v_lanc_banco, v_lanc_cartao];
end;
$function$;

revoke execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) to authenticated;
