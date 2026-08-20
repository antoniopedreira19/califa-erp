-- =====================================================================
-- RPCs de desembolso + patch em dar_baixa_lote_cartao.
-- Padrão herdado de aprovar_pp_com_data / dar_baixa_pp_parcela /
-- estornar_baixa_pp_parcela (migrations 20260817000004 e 20260818000002).
-- =====================================================================

-- 1. Aprovar desembolso definindo a data de pagamento.
create or replace function aprovar_desembolso_com_data(
  p_desembolso_id uuid,
  p_data_pagamento date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desembolso     desembolsos%rowtype;
  v_user_id        uuid := auth.uid();
  v_venc_primeira  date;
  v_delta          integer;
begin
  if v_user_id is null then raise exception 'Sessão inválida.'; end if;

  select * into v_desembolso from desembolsos where id = p_desembolso_id;
  if not found then raise exception 'Desembolso não encontrado.'; end if;

  if not is_tenant_member(v_desembolso.tenant_id) then
    raise exception 'Sem acesso a este desembolso.';
  end if;

  if v_desembolso.status <> 'em_avaliacao' then
    raise exception 'Desembolso precisa estar em avaliação (status atual: %).', v_desembolso.status;
  end if;

  if p_data_pagamento is null then
    raise exception 'Escolha a data de pagamento antes de aprovar.';
  end if;

  select data_vencimento into v_venc_primeira
    from desembolsos_parcelas
   where desembolso_id = p_desembolso_id
   order by numero
   limit 1;

  if v_venc_primeira is null then
    raise exception 'Desembolso sem parcelas — não é possível aprovar.';
  end if;

  v_delta := p_data_pagamento - v_venc_primeira;

  update desembolsos_parcelas
     set data_pagamento          = data_vencimento + v_delta,
         data_pagamento_primeira = coalesce(data_pagamento_primeira,
                                            data_vencimento + v_delta)
   where desembolso_id = p_desembolso_id;

  update desembolsos
     set status       = 'aprovada',
         aprovada_em  = now(),
         aprovada_por = v_user_id
   where id = p_desembolso_id;
end;
$$;

comment on function aprovar_desembolso_com_data(uuid, date) is
  'Aprova o desembolso e define a data de pagamento das parcelas, deslocando todas pelo mesmo delta em relação ao vencimento da 1ª. Padrão herdado de aprovar_pp_com_data.';

revoke execute on function aprovar_desembolso_com_data(uuid, date) from public;
grant execute on function aprovar_desembolso_com_data(uuid, date) to authenticated;


-- 2. Dar baixa em uma parcela.
create or replace function dar_baixa_desembolso_parcela(
  p_parcela_id             uuid,
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
  v_parcela        desembolsos_parcelas%rowtype;
  v_desembolso     desembolsos%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;
  if not found then raise exception 'Desembolso não encontrado.'; end if;

  if v_desembolso.status <> 'aprovada' then
    raise exception 'O desembolso precisa estar aprovado antes da baixa (status atual: %).', v_desembolso.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_desembolso.empresa_id then
    raise exception 'Conta bancária não pertence à empresa do desembolso.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id;

  update desembolsos_parcelas
     set pago_em  = p_pago_em,
         pago_por = p_criado_por
   where id = p_parcela_id;

  v_descricao := 'Desembolso ' || v_desembolso.codigo
                 || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(v_desembolso.descricao, 1, 140);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    desembolso_id, desembolso_parcela_id,
    origem, criado_por
  ) values (
    v_desembolso.tenant_id, v_desembolso.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
    v_desembolso.id, v_parcela.id,
    'desembolso_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  -- Promove desembolso a "pago" quando não sobra parcela em aberto.
  select count(*)::int into v_em_aberto
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id and pago_em is null;

  if v_em_aberto = 0 then
    update desembolsos
       set status   = 'pago',
           pago_em  = now(),
           pago_por = p_criado_por
     where id = v_desembolso.id;
  end if;

  return v_lancamento_id;
end;
$$;

comment on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid) is
  'Baixa UMA parcela de desembolso aprovado, gera o lançamento com o valor da parcela e promove o desembolso a pago quando a última parcela é quitada. Padrão herdado de dar_baixa_pp_parcela.';

revoke execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid) from public;
grant execute on function dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid) to authenticated;


-- 3. Estornar a baixa de uma parcela.
create or replace function estornar_baixa_desembolso_parcela(
  p_parcela_id uuid,
  p_motivo     text,
  p_criado_por uuid
)
returns uuid
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
    origem, criado_por
  ) values (
    v_lanc_original.tenant_id, v_lanc_original.empresa_id, v_lanc_original.conta_bancaria_id, current_date, v_lanc_original.valor,
    'entrada', 'Estorno: ' || substring(p_motivo, 1, 200), v_lanc_original.plano_conta_tipo_id, v_lanc_original.plano_conta_subtipo_id,
    v_lanc_original.fornecedor_id, v_lanc_original.cliente_id, v_lanc_original.job_id,
    v_lanc_original.desembolso_id, v_lanc_original.desembolso_parcela_id,
    'desembolso_estorno', p_criado_por
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

comment on function estornar_baixa_desembolso_parcela(uuid, text, uuid) is
  'Estorna a baixa de UMA parcela de desembolso. Padrão herdado de estornar_baixa_pp_parcela.';

revoke execute on function estornar_baixa_desembolso_parcela(uuid, text, uuid) from public;
grant execute on function estornar_baixa_desembolso_parcela(uuid, text, uuid) to authenticated;


-- 4. Patch em dar_baixa_lote_cartao: aceita origem 'desembolso'.
create or replace function dar_baixa_lote_cartao(
  p_titulos jsonb,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por uuid
) returns uuid[]
language plpgsql
security invoker
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

  for v_titulo in select * from jsonb_array_elements(p_titulos) loop
    v_origem := v_titulo->>'origem';
    v_id := (v_titulo->>'id')::uuid;

    if v_origem = 'pp' then
      v_lanc := dar_baixa_pp_parcela(
        v_id,
        p_pago_em,
        p_conta_bancaria_id,
        p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id,
        p_criado_por
      );
    elsif v_origem in ('avulso', 'recorrencia') then
      v_lanc := dar_baixa_avulsa_com_plano(
        v_id,
        p_pago_em,
        p_conta_bancaria_id,
        p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id
      );
    elsif v_origem = 'desembolso' then
      v_lanc := dar_baixa_desembolso_parcela(
        v_id,
        p_pago_em,
        p_conta_bancaria_id,
        p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id,
        p_criado_por
      );
    else
      raise exception 'origem desconhecida: %', v_origem;
    end if;

    v_ids := v_ids || v_lanc;
  end loop;

  return v_ids;
end;
$$;

revoke execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) from public;
grant execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) to authenticated;
