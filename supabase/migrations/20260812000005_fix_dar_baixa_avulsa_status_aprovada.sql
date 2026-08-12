-- =====================================================================
-- Fix: dar_baixa_avulsa aceita status 'aprovada' (antes: 'pendente')
-- Contexto: Migration 20260812000002 adicionou 'aprovada' ao enum e
-- 20260812000002b migrou todos os registros de 'pendente' para 'aprovada'.
-- A RPC original checa status = 'pendente', o que a torna inutilizável
-- para avulsas aprovadas. Esta migration corrige o check.
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

  -- Aceita 'aprovada' (novo fluxo) e 'pendente' (legado, transitório até Task 11)
  if v_avulsa.status not in ('aprovada', 'pendente') then
    raise exception 'Conta avulsa não está aprovada (status atual: %).', v_avulsa.status;
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
