-- Migration: 20260825000005_estornos_forma_cartao.sql
--
-- Problema (I2 do final-review da feature forma-pagamento-na-baixa):
--   As 3 RPCs de estorno não copiavam forma_pagamento/cartao_credito_id do
--   lançamento original para o lançamento reverso. Resultado: estornos ficavam
--   com NULL nesses campos, distorcendo relatórios DRE/cartão.
--
-- Correção: create or replace nas 3 RPCs, mesma assinatura, apenas o INSERT
--   do lançamento reverso é expandido com os dois campos do v_original
--   (ou v_lanc_original, conforme variável da RPC).
--
-- Risco: aditivo — nenhum dado existente é alterado.

-- -----------------------------------------------------------------------
-- 1. estornar_baixa_pp_parcela
-- -----------------------------------------------------------------------
create or replace function public.estornar_baixa_pp_parcela(
  p_parcela_id  uuid,
  p_motivo      text,
  p_criado_por  uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela    pedidos_compra_parcelas%rowtype;
  v_pp         pedidos_compra%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_total      integer;
  v_reverso_id uuid;
  v_descricao  text;
begin
  select * into v_parcela
    from public.pedidos_compra_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not public.is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is null then
    raise exception 'Esta parcela não está paga.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select * into v_pp
    from public.pedidos_compra where id = v_parcela.pedido_compra_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  select * into v_original
    from public.lancamentos_financeiros
   where pedido_compra_parcela_id = p_parcela_id
     and origem = 'pp_baixa';
  if not found then
    raise exception 'Lançamento da baixa desta parcela não encontrado.';
  end if;

  select count(*)::int into v_total
    from public.pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id;

  v_descricao := 'Estorno da baixa de ' || v_pp.codigo
                 || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(p_motivo, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
    estorno_de_lancamento_id, origem, criado_por,
    forma_pagamento, cartao_credito_id
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    case when v_original.natureza = 'saida' then 'entrada'::natureza_lancamento
         else 'saida'::natureza_lancamento end,
    v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.job_id, v_original.pedido_compra_id,
    v_original.pedido_compra_parcela_id,
    v_original.id, 'pp_estorno', p_criado_por,
    v_original.forma_pagamento, v_original.cartao_credito_id
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'pp_baixa_estornada'
   where id = v_original.id;

  update public.pedidos_compra_parcelas
     set pago_em  = null,
         pago_por = null
   where id = p_parcela_id;

  if v_pp.status = 'pago' then
    update public.pedidos_compra
       set status   = 'aprovada',
           pago_em  = null,
           pago_por = null
     where id = v_pp.id;
  end if;

  return v_reverso_id;
end;
$$;

-- -----------------------------------------------------------------------
-- 2. estornar_baixa_desembolso_parcela
-- -----------------------------------------------------------------------
create or replace function public.estornar_baixa_desembolso_parcela(
  p_parcela_id  uuid,
  p_motivo      text,
  p_criado_por  uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        desembolsos_parcelas%rowtype;
  v_desembolso     desembolsos%rowtype;
  v_lanc_original  lancamentos_financeiros%rowtype;
  v_lanc_reverso_id uuid;
begin
  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is null then
    raise exception 'Esta parcela não está paga.';
  end if;

  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo do estorno precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;

  -- Localiza o lançamento ativo da baixa desta parcela.
  select * into v_lanc_original
    from lancamentos_financeiros
   where desembolso_parcela_id = p_parcela_id
     and origem = 'desembolso_baixa'
     and cancelado_em is null
   limit 1;

  if not found then
    raise exception 'Lançamento de baixa da parcela não encontrado ou já estornado.';
  end if;

  -- Marca o lançamento original como estornado.
  update lancamentos_financeiros
     set origem        = 'desembolso_baixa_estornada',
         cancelado_em  = now(),
         cancelado_por = p_criado_por
   where id = v_lanc_original.id;

  -- Cria o lançamento reverso (entrada = mesmo valor, sinal contrário).
  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    desembolso_id, desembolso_parcela_id,
    origem, criado_por,
    forma_pagamento, cartao_credito_id
  ) values (
    v_lanc_original.tenant_id, v_lanc_original.empresa_id, v_lanc_original.conta_bancaria_id, current_date, v_lanc_original.valor,
    'entrada', 'Estorno: ' || substring(p_motivo, 1, 200), v_lanc_original.plano_conta_tipo_id, v_lanc_original.plano_conta_subtipo_id,
    v_lanc_original.fornecedor_id, v_lanc_original.cliente_id, v_lanc_original.job_id,
    v_lanc_original.desembolso_id, v_lanc_original.desembolso_parcela_id,
    'desembolso_estorno', p_criado_por,
    v_lanc_original.forma_pagamento, v_lanc_original.cartao_credito_id
  )
  returning id into v_lanc_reverso_id;

  -- Desmarca parcela como paga.
  update desembolsos_parcelas
     set pago_em  = null,
         pago_por = null
   where id = p_parcela_id;

  -- Se o desembolso estava 'pago', volta para 'aprovada'.
  if v_desembolso.status = 'pago' then
    update desembolsos
       set status   = 'aprovada',
           pago_em  = null,
           pago_por = null
     where id = v_desembolso.id;
  end if;

  return v_lanc_reverso_id;
end;
$$;

-- -----------------------------------------------------------------------
-- 3. estornar_baixa_avulsa
-- -----------------------------------------------------------------------
create or replace function public.estornar_baixa_avulsa(
  p_conta_avulsa_id uuid,
  p_motivo          text
) returns uuid
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
    estorno_de_lancamento_id, origem, criado_por,
    forma_pagamento, cartao_credito_id
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    v_natureza_rev, v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.cliente_id, v_original.job_id, v_original.conta_avulsa_id,
    v_original.id, 'avulsa_estorno', v_caller_uid,
    v_original.forma_pagamento, v_original.cartao_credito_id
  )
  returning id into v_reverso_id;

  update public.lancamentos_financeiros
     set origem = 'avulsa_baixa_estornada'
   where id = v_original.id;

  update public.contas_avulsas
     set status = 'aprovada',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null
   where id = p_conta_avulsa_id;

  return v_reverso_id;
end;
$$;
