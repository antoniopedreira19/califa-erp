-- As duas funções da baixa da fatura passam a usar a tríade nova.
--
-- `dar_baixa_fatura_cartao` grava `fatura_cartao_baixa` nas duas pernas.
-- `estornar_baixa_fatura_cartao` vira o espelho de `estornar_baixa_titulo`:
-- marca o original como `fatura_cartao_baixa_estornada` ANTES de inserir o
-- reverso — é o UPDATE que libera `uniq_baixa_ativa_por_fatura_cartao` — e
-- o reverso nasce com `estorno_de_lancamento_id` apontando para o que ele
-- anulou.
--
-- Com isso o corte por `created_at` da 20260831140001 sai de cena: quem
-- responde "esta baixa está viva?" é a própria linha, e não a ordem em que
-- as linhas nasceram.

create or replace function public.dar_baixa_fatura_cartao(
  p_fatura_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid   uuid;
  v_fatura       faturas_cartao%rowtype;
  v_cartao       cartoes_credito%rowtype;
  v_conta_banco  contas_bancarias%rowtype;
  v_conta_cartao contas_bancarias%rowtype;
  v_subtipo_tipo uuid;
  v_lanc_banco   uuid;
  v_lanc_cartao  uuid;
  v_descricao    text;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status = 'paga' then
    raise exception 'Esta fatura já foi paga.';
  end if;
  if v_fatura.status <> 'fechada' then
    raise exception 'Só fatura fechada pode ser paga — a aberta ainda recebe compra (status atual: %).', v_fatura.status;
  end if;
  if v_fatura.valor_cobrado is null then
    raise exception 'Fatura sem valor cobrado. Feche-a informando o valor do banco.';
  end if;
  if v_fatura.valor_cobrado <= 0 then
    raise exception
      'A fatura % fechou em % — os estornos cobriram as compras e não há o que pagar. O crédito fica no cartão e abate a próxima fatura.',
      v_fatura.codigo,
      to_char(v_fatura.valor_cobrado, 'FM999999999990.00');
  end if;

  select * into v_cartao from cartoes_credito where id = v_fatura.cartao_credito_id;

  select * into v_conta_cartao from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  select * into v_conta_banco from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;

  if v_conta_banco.cartao_credito_id is not null then
    raise exception 'Fatura de cartão não se paga com outro cartão.';
  end if;
  if v_conta_banco.tenant_id <> v_fatura.tenant_id then
    raise exception 'Conta bancária de outro tenant.';
  end if;
  if not v_conta_banco.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta_banco.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_descricao := 'Fatura ' || v_fatura.codigo || ' · ' || v_cartao.nome;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
    origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_banco.empresa_id, p_conta_bancaria_id,
    p_pago_em, v_fatura.valor_cobrado, 'saida', v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'pagamento',
    'fatura_cartao_baixa', v_caller_uid
  )
  returning id into v_lanc_banco;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
    origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_cartao.empresa_id, v_conta_cartao.id,
    p_pago_em, v_fatura.valor_cobrado, 'entrada', 'Pagamento da ' || v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'pagamento',
    'fatura_cartao_baixa', v_caller_uid
  )
  returning id into v_lanc_cartao;

  update faturas_cartao set status = 'paga' where id = p_fatura_id;

  return array[v_lanc_banco, v_lanc_cartao];
end;
$function$;

create or replace function public.estornar_baixa_fatura_cartao(
  p_fatura_id uuid,
  p_motivo text
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid uuid;
  v_fatura     faturas_cartao%rowtype;
  v_pag        record;
  v_novo       uuid;
  v_ids        uuid[] := '{}';
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Diga por que a baixa está sendo estornada.';
  end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status <> 'paga' then
    raise exception 'Só fatura paga tem baixa para estornar (status atual: %).', v_fatura.status;
  end if;

  -- Contra-lançamento, não delete: aqui o dinheiro saiu de verdade, e o
  -- extrato do banco também vai mostrar as duas pernas.
  --
  -- Só a baixa VIVA: `fatura_cartao_baixa`. Os pares de ciclos anteriores
  -- já viraram `fatura_cartao_baixa_estornada` e ficam de fora — sem isso
  -- o segundo estorno devolveria também o primeiro pagamento.
  for v_pag in
    select l.* from lancamentos_financeiros l
     where l.fatura_cartao_id = p_fatura_id
       and l.origem = 'fatura_cartao_baixa'
     order by l.created_at
  loop
    -- O UPDATE vem ANTES do INSERT: é ele que libera
    -- `uniq_baixa_ativa_por_fatura_cartao` para a próxima baixa.
    update lancamentos_financeiros
       set origem = 'fatura_cartao_baixa_estornada'
     where id = v_pag.id;

    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      estorno_de_lancamento_id, origem, criado_por
    ) values (
      v_pag.tenant_id, v_pag.empresa_id, v_pag.conta_bancaria_id,
      current_date, v_pag.valor,
      case when v_pag.natureza = 'saida' then 'entrada' else 'saida' end::natureza_lancamento,
      'Estorno · ' || substring(v_pag.descricao, 1, 170),
      v_pag.plano_conta_tipo_id, v_pag.plano_conta_subtipo_id,
      null, v_fatura.cartao_credito_id, p_fatura_id, 'pagamento_estorno',
      v_pag.id, 'fatura_cartao_estorno', v_caller_uid
    )
    returning id into v_novo;

    v_ids := v_ids || v_novo;
  end loop;

  if array_length(v_ids, 1) is null then
    raise exception 'A fatura % está paga mas não tem baixa viva para estornar.', v_fatura.codigo;
  end if;

  update faturas_cartao set status = 'fechada' where id = p_fatura_id;

  insert into audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_fatura.tenant_id, 'fatura_cartao', p_fatura_id::text,
    'fatura_cartao.baixa_estornada', v_caller_uid,
    jsonb_build_object(
      'codigo', v_fatura.codigo,
      'motivo', btrim(p_motivo),
      'valor', v_fatura.valor_cobrado,
      'lancamentos', to_jsonb(v_ids)
    )
  );

  return v_ids;
end;
$function$;

comment on function public.estornar_baixa_fatura_cartao(uuid, text) is
  'Contra-lança a baixa VIVA da fatura (origem = fatura_cartao_baixa), marca a original como fatura_cartao_baixa_estornada e devolve a fatura para fechada. O reverso aponta para o que anulou em estorno_de_lancamento_id.';
