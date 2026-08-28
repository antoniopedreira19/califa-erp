-- A compra no cartão pousa na CONTA DO CARTÃO, não no banco.
--
-- Terceira fatia do módulo de Fatura, passo 1 de 4. Até aqui, dar baixa
-- numa avulsa com forma "cartão de crédito" debitava a conta bancária na
-- hora — como se o dinheiro tivesse saído do banco. Não saiu: quem pagou o
-- fornecedor foi a administradora do cartão, e o que a California passou a
-- dever é a FATURA.
--
-- O que muda: o lançamento nasce na conta espelho do cartão. O saldo do
-- cartão sobe a cada compra e só desce quando a fatura for paga (passo 4),
-- que é uma transferência banco -> cartão.
--
-- ⚠️ O saldo do cartão é CONTÍNUO. O fechamento é uma linha de corte para
-- agrupar, não um zeramento: a compra feita entre o fechamento e o
-- pagamento já é da fatura seguinte e sobrevive ao pagamento da anterior.
-- Por isso a conta é o CARTÃO e a fatura é uma janela dentro dela.
--
-- A assinatura da função não muda — `dar_baixa_lote_cartao` e a action de
-- baixa individual continuam chamando igual. Com forma "cartão",
-- `p_conta_bancaria_id` passa a ser ignorado: a conta certa é derivada do
-- cartão, e não escolhida por quem chama.

create or replace function public.dar_baixa_avulsa_com_plano(
  p_conta_avulsa_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_forma_pagamento forma_pagamento,
  p_cartao_credito_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_conta_id       uuid;
  v_subtipo_tipo   uuid;
  v_descricao      text;
  v_lancamento_id  uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_avulsa from contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Só avulsa aprovada pode ser baixada (status atual: %).', v_avulsa.status;
  end if;

  -- Qual conta recebe o lançamento.
  --
  -- No cartão, a conta é DERIVADA do cartão — quem chama não escolhe. Sem
  -- isso a compra debitaria o banco, e o banco só é debitado quando a
  -- fatura é paga.
  if p_forma_pagamento = 'cartao_credito' then
    select id into v_conta_id
      from contas_bancarias
     where cartao_credito_id = p_cartao_credito_id;

    if v_conta_id is null then
      raise exception 'Cartão sem conta espelho. Avise o suporte.';
    end if;
  else
    v_conta_id := p_conta_bancaria_id;
  end if;

  select * into v_conta from contas_bancarias where id = v_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_avulsa.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da conta avulsa.';
  end if;
  if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  update contas_avulsas
     set status = 'baixada', pago_em = p_pago_em, pago_por = v_caller_uid,
         conta_bancaria_baixa_id = v_conta_id
   where id = p_conta_avulsa_id;

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, v_conta_id, p_pago_em, v_avulsa.valor,
    v_avulsa.natureza, v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    p_forma_pagamento, p_cartao_credito_id,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$function$;
