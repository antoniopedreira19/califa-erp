-- =====================================================================
-- Endurece RPCs de baixa e estorno: exigem/retornam status='aprovada'
-- Task 11 — tightens transitional guards from Tasks 7 and earlier.
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- =====================================================================

-- 1) dar_baixa_pp — exige status='aprovada' (era 'em_avaliacao')
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
  if v_pp.status <> 'aprovada' then
    raise exception 'PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
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

-- 2) estornar_baixa_pp — devolve pra 'aprovada' (era 'em_avaliacao')
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

  -- 5. UPDATE PP → aprovada (mantém aprovada_em/aprovada_por originais)
  update public.pedidos_compra
     set status = 'aprovada',
         pago_em = null,
         pago_por = null
   where id = p_pp_id;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_pp(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------

-- 3) dar_baixa_avulsa — exige status='aprovada' (remove aceite de 'pendente' do Task 7)
create or replace function public.dar_baixa_avulsa(
  p_conta_avulsa_id     uuid,
  p_pago_em             date,
  p_conta_bancaria_id   uuid
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
  v_descricao      text;
  v_lancamento_id  uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not public.is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  -- Exige apenas 'aprovada' (transitório 'pendente' removido nesta task)
  if v_avulsa.status <> 'aprovada' then
    raise exception 'Só avulsa aprovada pode ser baixada (status atual: %).', v_avulsa.status;
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;

  if v_conta.empresa_id <> v_avulsa.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da conta avulsa.';
  end if;

  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;

  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  update public.contas_avulsas
     set status = 'baixada',
         pago_em = p_pago_em,
         pago_por = v_caller_uid,
         conta_bancaria_baixa_id = p_conta_bancaria_id
   where id = p_conta_avulsa_id;

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_avulsa.valor,
    v_avulsa.natureza, v_descricao, v_avulsa.plano_conta_tipo_id, v_avulsa.plano_conta_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

grant execute on function public.dar_baixa_avulsa(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------

-- 4) estornar_baixa_avulsa — devolve pra 'aprovada' (era 'pendente')
create or replace function public.estornar_baixa_avulsa(
  p_conta_avulsa_id  uuid,
  p_motivo           text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_original       lancamentos_financeiros%rowtype;
  v_reverso_id     uuid;
  v_descricao      text;
  v_natureza_rev   natureza_lancamento;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not public.is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  if v_avulsa.status <> 'baixada' then
    raise exception 'Conta avulsa não está baixada (status atual: %).', v_avulsa.status;
  end if;

  select * into v_original
    from public.lancamentos_financeiros
   where conta_avulsa_id = p_conta_avulsa_id and origem = 'avulsa_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  v_natureza_rev := case when v_original.natureza = 'saida' then 'entrada'::natureza_lancamento
                        else 'saida'::natureza_lancamento end;

  v_descricao := 'Estorno da baixa · ' || substring(v_avulsa.descricao, 1, 100)
                 || ' — ' || substring(p_motivo, 1, 200);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    v_natureza_rev, v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.cliente_id, v_original.job_id, v_original.conta_avulsa_id,
    v_original.id, 'avulsa_estorno', v_caller_uid
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'avulsa_baixa_estornada'
   where id = v_original.id;

  -- Devolve pra 'aprovada' (não 'pendente' — coerente com o novo ciclo)
  update public.contas_avulsas
     set status = 'aprovada',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null
   where id = p_conta_avulsa_id;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_avulsa(uuid, text) to authenticated;
