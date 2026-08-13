-- =====================================================================
-- RPCs transacionais de baixa e estorno de titulo a receber.
-- Ao baixar/estornar o ultimo titulo ativo de um faturamento com
-- origem_tipo='bv', atualiza itens_bv.situacao pra fechar/reabrir o ciclo.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

create or replace function public.dar_baixa_titulo(
  p_titulo_id            uuid,
  p_pago_em              date,
  p_conta_bancaria_id    uuid,
  p_criado_por           uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo         titulos_receber%rowtype;
  v_fat            faturamentos%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_lancamento_id  uuid;
  v_descricao      text;
  v_todos_pagos    boolean;
begin
  -- 1. Carrega titulo + valida
  select * into v_titulo from public.titulos_receber where id = p_titulo_id;
  if not found then raise exception 'Título não encontrado.'; end if;
  if not public.is_tenant_member(v_titulo.tenant_id) then
    raise exception 'Sem acesso a este título.';
  end if;
  if v_titulo.status <> 'em_aberto' then
    raise exception 'Título não está em aberto (status atual: %).', v_titulo.status;
  end if;

  -- 2. Carrega faturamento pai (pra descrição, tipo/subtipo, contraparte)
  select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;
  if v_fat.status = 'cancelado' then
    raise exception 'Faturamento pai está cancelado.';
  end if;

  -- 3. Carrega conta + valida empresa/data
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_titulo.empresa_id then
    raise exception 'Conta bancária não pertence à empresa do título.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do recebimento é anterior à data do saldo inicial da conta.';
  end if;

  -- 4. INSERT lançamento (natureza=entrada)
  v_descricao := 'Recebimento NF ' || v_fat.numero_nf || '/' ||
                 v_titulo.numero_parcela::text || ' — ' ||
                 substring(v_fat.descricao, 1, 120);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id,
    titulo_receber_id, origem, criado_por
  ) values (
    v_titulo.tenant_id, v_titulo.empresa_id, p_conta_bancaria_id, p_pago_em, v_titulo.valor,
    'entrada', v_descricao, v_fat.plano_conta_tipo_id, v_fat.plano_conta_subtipo_id,
    v_fat.fornecedor_id, v_fat.cliente_id,
    v_titulo.id, 'titulo_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  -- 5. UPDATE título → pago
  update public.titulos_receber
     set status = 'pago',
         pago_em = p_pago_em,
         pago_por = p_criado_por,
         conta_bancaria_recebimento_id = p_conta_bancaria_id,
         lancamento_id = v_lancamento_id
   where id = p_titulo_id;

  -- 6. Se origem='bv' e agora todos os títulos do faturamento estão pagos,
  --    atualiza itens_bv.situacao = 'recebido'
  if v_fat.origem_tipo = 'bv' then
    select bool_and(status = 'pago')
      into v_todos_pagos
      from public.titulos_receber
     where faturamento_id = v_fat.id
       and status <> 'cancelado';
    if v_todos_pagos then
      update public.itens_bv
         set situacao = 'recebido'
       where id = v_fat.origem_id;
    end if;
  end if;

  return v_lancamento_id;
end;
$$;

grant execute on function public.dar_baixa_titulo(uuid, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_titulo(
  p_titulo_id   uuid,
  p_motivo      text,
  p_criado_por  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo     titulos_receber%rowtype;
  v_fat        faturamentos%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_reverso_id uuid;
  v_descricao  text;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_titulo from public.titulos_receber where id = p_titulo_id;
  if not found then raise exception 'Título não encontrado.'; end if;
  if not public.is_tenant_member(v_titulo.tenant_id) then
    raise exception 'Sem acesso a este título.';
  end if;
  if v_titulo.status <> 'pago' then
    raise exception 'Título não está pago (status atual: %).', v_titulo.status;
  end if;

  select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;

  -- Carrega lançamento original (única baixa ativa)
  select * into v_original
    from public.lancamentos_financeiros
   where titulo_receber_id = p_titulo_id and origem = 'titulo_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  v_descricao := 'Estorno da baixa NF ' || v_fat.numero_nf || '/' ||
                 v_titulo.numero_parcela::text || ' — ' ||
                 substring(p_motivo, 1, 200);

  -- UPDATE original → libera unique parcial ANTES do INSERT do reverso
  update public.lancamentos_financeiros
     set origem = 'titulo_baixa_estornada'
   where id = v_original.id;

  -- INSERT lançamento reverso (natureza=saida)
  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, titulo_receber_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    'saida'::natureza_lancamento,
    v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.cliente_id, v_original.titulo_receber_id,
    v_original.id, 'titulo_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  -- UPDATE título → em_aberto (limpa fields de baixa)
  update public.titulos_receber
     set status = 'em_aberto',
         pago_em = null,
         pago_por = null,
         conta_bancaria_recebimento_id = null,
         lancamento_id = null
   where id = p_titulo_id;

  -- Se origem='bv' e BV estava 'recebido', volta pra 'confirmado'
  if v_fat.origem_tipo = 'bv' then
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_fat.origem_id
       and situacao = 'recebido';
  end if;

  return v_reverso_id;
end;
$$;

grant execute on function public.estornar_baixa_titulo(uuid, text, uuid) to authenticated;
