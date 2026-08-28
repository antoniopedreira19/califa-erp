-- Pagar a fatura: a transferência banco -> cartão.
--
-- Fatia 3, passo 4 de 4 — o que fecha o loop.
--
-- São DOIS lançamentos, e é isso que faz as duas contas ficarem certas ao
-- mesmo tempo:
--
--   · SAÍDA na conta bancária  — o dinheiro que de fato saiu do banco. É
--     esta linha que bate com o extrato: um débito só, do valor da fatura.
--   · ENTRADA na conta do cartão — quita o que o cartão acumulou. Sem ela
--     o saldo do cartão só cresceria, para sempre.
--
-- O plano de contas da despesa JÁ foi lançado no fechamento, item a item,
-- na conta do cartão. Estas duas linhas são movimentação de caixa, não
-- despesa nova — contar de novo aqui dobraria o custo no DRE. Por isso o
-- plano de contas que entra nelas é o de TRANSFERÊNCIA, escolhido por quem
-- paga.
--
-- ⚠️ Só fatura FECHADA se paga. Fatura aberta ainda recebe compra, e pagar
-- um valor que ainda vai mudar deixaria o cartão com saldo errado.

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
  v_conta_cartao uuid;
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
  if v_fatura.valor_cobrado is null or v_fatura.valor_cobrado <= 0 then
    raise exception 'Fatura sem valor cobrado. Feche-a informando o valor do banco.';
  end if;

  select * into v_cartao from cartoes_credito where id = v_fatura.cartao_credito_id;

  select id into v_conta_cartao
    from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if v_conta_cartao is null then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  -- A conta que paga é banco de verdade, nunca outro cartão.
  select * into v_conta_banco from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta_banco.cartao_credito_id is not null then
    raise exception 'Fatura de cartão não se paga com outro cartão.';
  end if;
  if v_conta_banco.empresa_id <> v_cartao.empresa_id then
    raise exception 'A conta bancária não pertence à empresa do cartão.';
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

  -- 1. O dinheiro sai do banco.
  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id,
    origem, criado_por
  ) values (
    v_fatura.tenant_id, v_cartao.empresa_id, p_conta_bancaria_id,
    p_pago_em, v_fatura.valor_cobrado,
    'saida', v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id,
    'manual', v_caller_uid
  )
  returning id into v_lanc_banco;

  -- 2. E quita o cartão.
  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id,
    origem, criado_por
  ) values (
    v_fatura.tenant_id, v_cartao.empresa_id, v_conta_cartao,
    p_pago_em, v_fatura.valor_cobrado,
    'entrada', 'Pagamento da ' || v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id,
    'manual', v_caller_uid
  )
  returning id into v_lanc_cartao;

  update faturas_cartao set status = 'paga' where id = p_fatura_id;

  return array[v_lanc_banco, v_lanc_cartao];
end;
$function$;

revoke execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) from public;
grant execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) to authenticated;
