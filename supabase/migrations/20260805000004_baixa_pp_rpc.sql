-- =====================================================================
-- Task 011 — RPCs transacionais de baixa e estorno de PP
-- =====================================================================

create or replace function public.dar_baixa_pp(
  p_pp_id                    uuid,
  p_pago_em                  date,
  p_conta_bancaria_id        uuid,
  p_plano_conta_tipo_id      uuid,
  p_plano_conta_subtipo_id   uuid,
  p_criado_por               uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  -- 1. Carrega PP + valida
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'em_avaliacao' then
    raise exception 'PP não está em avaliação (status atual: %).', v_pp.status;
  end if;

  -- 2. Carrega conta + valida empresa bate
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_pp.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da PP.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  -- 3. Valida subtipo pertence ao tipo
  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  -- 4. UPDATE PP → pago
  update public.pedidos_compra
     set status = 'pago',
         pago_em = p_pago_em,
         pago_por = p_criado_por
   where id = p_pp_id;

  -- 5. INSERT lançamento
  v_descricao := 'PP ' || v_pp.codigo || ' — ' || substring(v_pp.servico, 1, 150);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, origem, criado_por
  ) values (
    v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_pp.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_pp.fornecedor_id, v_pp.job_id, v_pp.id, 'pp_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

grant execute on function public.dar_baixa_pp(uuid, date, uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_pp(
  p_pp_id       uuid,
  p_motivo      text,
  p_criado_por  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_original       lancamentos_financeiros%rowtype;
  v_reverso_id     uuid;
  v_descricao      text;
begin
  -- 1. Carrega PP + valida
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'pago' then
    raise exception 'PP não está paga (status atual: %).', v_pp.status;
  end if;

  -- 2. Carrega lançamento original (única baixa ativa)
  select * into v_original
    from public.lancamentos_financeiros
   where pedido_compra_id = p_pp_id and origem = 'pp_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  -- 3. INSERT lançamento reverso (natureza invertida)
  v_descricao := 'Estorno da baixa de ' || v_pp.codigo || ' — ' || substring(p_motivo, 1, 200);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    -- Inverte natureza
    case when v_original.natureza = 'saida' then 'entrada'::natureza_lancamento
         else 'saida'::natureza_lancamento end,
    v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.job_id, v_original.pedido_compra_id,
    v_original.id, 'pp_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  -- 4. UPDATE origem do lançamento original → libera unique parcial
  update public.lancamentos_financeiros
     set origem = 'pp_baixa_estornada'
   where id = v_original.id;

  -- 5. UPDATE PP → em_avaliacao
  update public.pedidos_compra
     set status = 'em_avaliacao',
         pago_em = null,
         pago_por = null
   where id = p_pp_id;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_pp(uuid, text, uuid) to authenticated;
