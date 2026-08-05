-- =====================================================================
-- Task 011 — final-review fixes: RPC tenant enforcement
--
-- Replaces dar_baixa_pp and estornar_baixa_pp with versions that:
--   1. Verify caller is authenticated (auth.uid() not null).
--   2. Verify caller is a member of the PP's tenant.
--   3. Derive criado_por from auth.uid() instead of trusting the caller
--      parameter (p_criado_por is kept for backward-compat but ignored).
--
-- Notes on profiles.id:
--   profiles.id = auth.users.id (1:1 via FK). So auth.uid() IS the
--   profile id directly — no join needed.
-- =====================================================================

create or replace function public.dar_baixa_pp(
  p_pp_id                    uuid,
  p_pago_em                  date,
  p_conta_bancaria_id        uuid,
  p_plano_conta_tipo_id      uuid,
  p_plano_conta_subtipo_id   uuid,
  p_criado_por               uuid  -- kept for backward compat; ignored internally
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
  v_caller_id      uuid;  -- profiles.id = auth.uid() (1:1)
begin
  -- 0. Rejeita sessão anônima
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Sessão inválida. Faça login novamente.';
  end if;

  -- 1. Carrega PP + valida status
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'em_avaliacao' then
    raise exception 'PP não está em avaliação (status atual: %).', v_pp.status;
  end if;

  -- 2. Verifica tenant — o caller deve ser membro do tenant da PP
  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem permissão para operar nesta PP.';
  end if;

  -- 3. Carrega conta + valida empresa bate
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

  -- 4. Valida subtipo pertence ao tipo
  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  -- 5. UPDATE PP → pago (usa caller derivado, não o parâmetro)
  update public.pedidos_compra
     set status   = 'pago',
         pago_em  = p_pago_em,
         pago_por = v_caller_id
   where id = p_pp_id;

  -- 6. INSERT lançamento (criado_por = caller autenticado)
  v_descricao := 'PP ' || v_pp.codigo || ' — ' || substring(v_pp.servico, 1, 150);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, origem, criado_por
  ) values (
    v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_pp.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_pp.fornecedor_id, v_pp.job_id, v_pp.id, 'pp_baixa', v_caller_id
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
  p_criado_por  uuid  -- kept for backward compat; ignored internally
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
  v_caller_id      uuid;  -- profiles.id = auth.uid() (1:1)
begin
  -- 0. Rejeita sessão anônima
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Sessão inválida. Faça login novamente.';
  end if;

  -- 1. Carrega PP + valida status
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'pago' then
    raise exception 'PP não está paga (status atual: %).', v_pp.status;
  end if;

  -- 2. Verifica tenant — o caller deve ser membro do tenant da PP
  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem permissão para operar nesta PP.';
  end if;

  -- 3. Carrega lançamento original (única baixa ativa)
  select * into v_original
    from public.lancamentos_financeiros
   where pedido_compra_id = p_pp_id and origem = 'pp_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  -- 4. INSERT lançamento reverso (natureza invertida, criado_por = caller)
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
    v_original.id, 'pp_estorno', v_caller_id
  )
  returning id into v_reverso_id;

  -- 5. UPDATE origem do lançamento original → libera unique parcial
  update public.lancamentos_financeiros
     set origem = 'pp_baixa_estornada'
   where id = v_original.id;

  -- 6. UPDATE PP → em_avaliacao
  update public.pedidos_compra
     set status   = 'em_avaliacao',
         pago_em  = null,
         pago_por = null
   where id = p_pp_id;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_pp(uuid, text, uuid) to authenticated;
