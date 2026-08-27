-- =====================================================================
-- RPCs de baixa passam a receber e gravar forma_pagamento + cartao_credito_id.
-- dar_baixa_lote_cartao perde branches PP e Desembolso (agora aceita
-- só avulso/recorrencia; PP/Desembolso pendentes nao sabem forma).
-- Ver spec seção 3.6 e 3.7.
--
-- Depende de: 20260825000001 (colunas em lancamentos_financeiros).
-- =====================================================================

-- 1. dar_baixa_pp_parcela — nova assinatura com 2 parametros.
create or replace function dar_baixa_pp_parcela(
  p_parcela_id             uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid,
  p_forma_pagamento        forma_pagamento,
  p_cartao_credito_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        pedidos_compra_parcelas%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  -- Validacao coerencia forma <-> cartao
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_parcela from pedidos_compra_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_pp from pedidos_compra where id = v_parcela.pedido_compra_id;
  if v_pp.status <> 'aprovada' then
    raise exception 'A PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_pp.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da PP.';
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

  select count(*)::int into v_total from pedidos_compra_parcelas where pedido_compra_id = v_pp.id;

  update pedidos_compra_parcelas
     set pago_em = p_pago_em, pago_por = p_criado_por
   where id = p_parcela_id;

  v_descricao := 'PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(v_pp.servico, 1, 140);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_pp.fornecedor_id, v_pp.job_id, v_pp.id, v_parcela.id,
    p_forma_pagamento, p_cartao_credito_id,
    'pp_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  select count(*)::int into v_em_aberto
    from pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id and pago_em is null;

  if v_em_aberto = 0 then
    update pedidos_compra
       set status = 'pago', pago_em = p_pago_em, pago_por = p_criado_por
     where id = v_pp.id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke execute on function dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant execute on function dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;


-- 2. dar_baixa_desembolso_parcela — mesma estrutura, 2 parametros novos.
create or replace function dar_baixa_desembolso_parcela(
  p_parcela_id             uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid,
  p_forma_pagamento        forma_pagamento,
  p_cartao_credito_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        desembolsos_parcelas%rowtype;
  v_desembolso     desembolsos%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;
  if v_desembolso.status <> 'aprovada' then
    raise exception 'O desembolso precisa estar aprovado antes da baixa (status atual: %).', v_desembolso.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_desembolso.empresa_id then
    raise exception 'Conta bancária não pertence à empresa do desembolso.';
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

  select count(*)::int into v_total from desembolsos_parcelas where desembolso_id = v_desembolso.id;

  update desembolsos_parcelas
     set pago_em = p_pago_em, pago_por = p_criado_por
   where id = p_parcela_id;

  v_descricao := 'Desembolso ' || v_desembolso.codigo || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(v_desembolso.descricao, 1, 140);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    desembolso_id, desembolso_parcela_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_desembolso.tenant_id, v_desembolso.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
    v_desembolso.id, v_parcela.id,
    p_forma_pagamento, p_cartao_credito_id,
    'desembolso_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  select count(*)::int into v_em_aberto
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id and pago_em is null;

  if v_em_aberto = 0 then
    update desembolsos
       set status = 'pago', pago_em = now(), pago_por = p_criado_por
     where id = v_desembolso.id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;


-- 3. dar_baixa_avulsa_com_plano — mesma extensao.
create or replace function dar_baixa_avulsa_com_plano(
  p_conta_avulsa_id        uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_forma_pagamento        forma_pagamento,
  p_cartao_credito_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
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

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
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
         conta_bancaria_baixa_id = p_conta_bancaria_id
   where id = p_conta_avulsa_id;

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_avulsa.valor,
    v_avulsa.natureza, v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    p_forma_pagamento, p_cartao_credito_id,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

revoke execute on function dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant execute on function dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;


-- 4. dar_baixa_lote_cartao — remove branches PP/Desembolso, ganha p_cartao_credito_id.
create or replace function dar_baixa_lote_cartao(
  p_titulos                jsonb,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid,
  p_cartao_credito_id      uuid
) returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_titulo jsonb;
  v_origem text;
  v_id uuid;
  v_lanc uuid;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_titulos) <> 'array' then
    raise exception 'p_titulos deve ser array jsonb';
  end if;
  if jsonb_array_length(p_titulos) = 0 then
    raise exception 'Nenhum título selecionado';
  end if;
  if p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório na baixa em lote.';
  end if;

  for v_titulo in select * from jsonb_array_elements(p_titulos) loop
    v_origem := v_titulo->>'origem';
    v_id := (v_titulo->>'id')::uuid;

    if v_origem in ('avulso','recorrencia') then
      v_lanc := dar_baixa_avulsa_com_plano(
        v_id, p_pago_em,
        p_conta_bancaria_id, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
        'cartao_credito', p_cartao_credito_id
      );
    else
      raise exception 'Baixa em lote só aceita avulso e recorrencia (recebido: %).', v_origem;
    end if;

    v_ids := v_ids || v_lanc;
  end loop;

  return v_ids;
end;
$$;

revoke execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid, uuid) to authenticated;
