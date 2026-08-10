-- =====================================================================
-- Task 012 — RPCs transacionais de baixa e estorno de conta avulsa
-- Hardening: criado_por derivado de auth.uid() (não é parâmetro cliente).
-- =====================================================================

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

  if v_avulsa.status <> 'pendente' then
    raise exception 'Conta avulsa não está pendente (status atual: %).', v_avulsa.status;
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

  update public.contas_avulsas
     set status = 'pendente',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null
   where id = p_conta_avulsa_id;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_avulsa(uuid, text) to authenticated;
