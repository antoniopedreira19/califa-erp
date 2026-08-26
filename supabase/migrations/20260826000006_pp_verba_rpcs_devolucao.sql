-- =====================================================================
-- v2 do fechar_prestacao_verba_pp + RPCs de baixa/estorno da devolução.
-- Enum origem_lancamento com pp_devolucao_verba já commitado em
-- 20260826000004; tabela pp_verba_devolucoes já criada em 20260826000005.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. fechar_prestacao_verba_pp v2 — passa a criar a devolução também
-- ---------------------------------------------------------------------

create or replace function public.fechar_prestacao_verba_pp(
  p_pp_id       uuid,
  p_valor_gasto numeric,
  p_fechada_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp                pedidos_compra%rowtype;
  v_prestacao_id      uuid;
  v_valor_devolvido   numeric(14,2);
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;

  if v_pp.verba_producao is not true then
    raise exception 'Esta PP não é de Verba de Produção.';
  end if;

  if v_pp.status <> 'pago' then
    raise exception 'A prestação de contas só pode ser feita depois que a PP for totalmente paga (status atual: %).', v_pp.status;
  end if;

  if exists (select 1 from public.pp_verba_prestacoes where pedido_compra_id = p_pp_id) then
    raise exception 'Esta PP já tem prestação de contas registrada.';
  end if;

  if p_valor_gasto is null or p_valor_gasto <= 0 then
    raise exception 'Informe um valor gasto maior que zero.';
  end if;

  if p_valor_gasto > v_pp.valor then
    raise exception 'O valor gasto (%) não pode ser maior que o valor da PP (%).',
      to_char(p_valor_gasto, 'FM999999999990.00'),
      to_char(v_pp.valor,    'FM999999999990.00');
  end if;

  v_valor_devolvido := v_pp.valor - p_valor_gasto;

  insert into public.pp_verba_prestacoes (
    tenant_id, pedido_compra_id, valor_gasto, valor_devolvido, fechada_por
  ) values (
    v_pp.tenant_id, v_pp.id, p_valor_gasto, v_valor_devolvido, p_fechada_por
  )
  returning id into v_prestacao_id;

  -- v2: cria devolução se sobrou dinheiro. data_pagamento nasce hoje —
  -- o financeiro repactua depois pelo lápis da aba Títulos a Pagar.
  if v_valor_devolvido > 0 then
    insert into public.pp_verba_devolucoes (
      tenant_id, empresa_id, prestacao_id, pedido_compra_id, valor,
      data_pagamento, data_pagamento_primeira
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, v_prestacao_id, v_pp.id, v_valor_devolvido,
      current_date, current_date
    );
  end if;

  return v_prestacao_id;
end;
$$;

comment on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) is
  'v2 (2026-08-26): fecha a prestação de contas e, se valor_devolvido > 0, cria pp_verba_devolucoes com data_pagamento = current_date.';

revoke execute on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) from public;
grant  execute on function public.fechar_prestacao_verba_pp(uuid, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. dar_baixa_devolucao_verba — baixa da entrada
-- ---------------------------------------------------------------------

create or replace function public.dar_baixa_devolucao_verba(
  p_devolucao_id           uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev            pp_verba_devolucoes%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id;
  if not found then raise exception 'Devolução não encontrada.'; end if;

  if not public.is_tenant_member(v_dev.tenant_id) then
    raise exception 'Sem acesso a esta devolução.';
  end if;

  if v_dev.pago_em is not null then
    raise exception 'Esta devolução já foi baixada.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;
  if not found then raise exception 'PP da devolução não encontrada.'; end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_dev.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da devolução.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do recebimento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_descricao := 'Devolução verba ' || v_pp.codigo
                 || ' — ' || substring(v_pp.servico, 1, 140);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pp_verba_devolucao_id,
    origem, criado_por
  ) values (
    v_dev.tenant_id, v_dev.empresa_id, p_conta_bancaria_id, p_pago_em, v_dev.valor,
    'entrada', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_pp.job_id, v_pp.id, v_dev.id,
    'pp_devolucao_verba', p_criado_por
  )
  returning id into v_lancamento_id;

  update public.pp_verba_devolucoes
     set pago_em       = p_pago_em,
         pago_por      = p_criado_por,
         lancamento_id = v_lancamento_id
   where id = p_devolucao_id;

  return v_lancamento_id;
end;
$$;

comment on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) is
  'Baixa da devolução de verba: gera lançamento de entrada com origem pp_devolucao_verba e marca a devolução como paga.';

revoke execute on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. estornar_baixa_devolucao_verba — devolve a devolução ao "aguardando"
-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_devolucao_verba(
  p_devolucao_id uuid,
  p_motivo       text,
  p_criado_por   uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev        pp_verba_devolucoes%rowtype;
  v_pp         pedidos_compra%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_reverso_id uuid;
  v_descricao  text;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id;
  if not found then raise exception 'Devolução não encontrada.'; end if;

  if not public.is_tenant_member(v_dev.tenant_id) then
    raise exception 'Sem acesso a esta devolução.';
  end if;

  if v_dev.pago_em is null then
    raise exception 'Esta devolução não está baixada.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;
  if not found then raise exception 'PP da devolução não encontrada.'; end if;

  select * into v_original
    from public.lancamentos_financeiros
   where id = v_dev.lancamento_id;
  if not found then
    raise exception 'Lançamento da baixa da devolução não encontrado.';
  end if;

  v_descricao := 'Estorno devolução verba ' || v_pp.codigo
                 || ' — ' || substring(p_motivo, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pp_verba_devolucao_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    'saida', v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    null, v_original.job_id, v_original.pedido_compra_id, v_original.pp_verba_devolucao_id,
    v_original.id, 'pp_devolucao_verba_estornada', p_criado_por
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'pp_devolucao_verba_estornada'
   where id = v_original.id;

  update public.pp_verba_devolucoes
     set pago_em       = null,
         pago_por      = null,
         lancamento_id = null
   where id = p_devolucao_id;

  return v_reverso_id;
end;
$$;

comment on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) is
  'Estorna a baixa da devolução de verba: gera lançamento reverso, marca o original como estornado, devolve a devolução ao estado aguardando baixa.';

revoke execute on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) from public;
grant  execute on function public.estornar_baixa_devolucao_verba(uuid, text, uuid) to authenticated;
