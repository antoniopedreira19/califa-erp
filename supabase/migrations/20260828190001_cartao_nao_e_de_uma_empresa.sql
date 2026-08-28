-- O cartão não pertence a uma empresa.
--
-- ⚠️ CORREÇÃO do que eu fiz em 20260828130001, apontada pelo Tiago no mesmo
-- dia: as contas bancárias da California pagam despesa de mais de uma
-- empresa, e não funcionam como uma conta por empresa. O cartão segue a
-- mesma lógica — travá-lo a uma empresa inventaria uma regra que a operação
-- não tem.
--
-- O que muda:
--   · `cartoes_credito.empresa_id` vira ANULÁVEL e deixa de ser exigido.
--   · A trava "a conta pagadora tem que ser da mesma empresa do cartão"
--     some de `dar_baixa_fatura_cartao`.
--   · A empresa do LANÇAMENTO passa a vir de quem realmente a tem: o item,
--     no fechamento (já vinha), e a conta bancária, no pagamento.
--
-- A conta espelho continua precisando de uma empresa — `contas_bancarias`
-- exige — e passa a cair na empresa principal quando o cartão não tem. Ali
-- ela é só preenchimento de coluna: nada mais decide nada a partir dela.

alter table public.cartoes_credito
  alter column empresa_id drop not null;

comment on column public.cartoes_credito.empresa_id is
  'Empresa dona do cartão, quando faz sentido dizer. NÃO restringe nada: o cartão paga despesa de qualquer empresa, como as contas bancárias fazem (28/08/2026).';

-- ---------------------------------------------------------------------
-- A conta espelho aceita cartão sem empresa
-- ---------------------------------------------------------------------

create or replace function public.sincronizar_conta_do_cartao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa_id uuid;
begin
  -- `contas_bancarias.empresa_id` é NOT NULL, mas a empresa da conta
  -- espelho não decide nada — nenhuma trava a consulta. Sem empresa no
  -- cartão, cai na principal só para preencher a coluna.
  v_empresa_id := coalesce(
    new.empresa_id,
    (select id from empresas
      where tenant_id = new.tenant_id and ativo
      order by principal desc, razao_social
      limit 1)
  );

  if v_empresa_id is null then
    raise exception 'Nenhuma empresa ativa no tenant para ancorar a conta do cartão.';
  end if;

  if tg_op = 'INSERT' then
    insert into public.contas_bancarias (
      tenant_id, empresa_id, nome, banco, tipo,
      saldo_inicial, saldo_inicial_data, ativo, cartao_credito_id, created_by
    ) values (
      new.tenant_id, v_empresa_id,
      new.nome, new.banco, 'cartao_credito',
      0, current_date, new.ativo, new.id, new.created_by
    );
    return new;
  end if;

  update public.contas_bancarias
     set nome        = new.nome,
         banco       = new.banco,
         empresa_id  = v_empresa_id,
         ativo       = new.ativo,
         updated_at  = now()
   where cartao_credito_id = new.id;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- O fechamento: a empresa do ajuste vem da conta, não do cartão
-- ---------------------------------------------------------------------
-- Os lançamentos por item já usavam `v_item.empresa_id` — cada despesa na
-- empresa dela, que é justamente o que permite um cartão só servir a duas
-- empresas. Só o lançamento de AJUSTE usava a do cartão.

create or replace function public.fechar_fatura_cartao(
  p_fatura_id uuid,
  p_valor_cobrado numeric,
  p_ajuste_tipo_id uuid default null,
  p_ajuste_subtipo_id uuid default null,
  p_ajuste_descricao text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid  uuid;
  v_fatura      faturas_cartao%rowtype;
  v_conta       contas_bancarias%rowtype;
  v_item        record;
  v_soma        numeric := 0;
  v_diferenca   numeric;
  v_subtipo_tipo uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status <> 'aberta' then
    raise exception 'Só fatura aberta pode ser fechada (status atual: %).', v_fatura.status;
  end if;

  if p_valor_cobrado is null or p_valor_cobrado <= 0 then
    raise exception 'Informe o valor cobrado pelo banco nesta fatura.';
  end if;

  select * into v_conta from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  for v_item in
    select a.*
      from contas_avulsas a
     where a.fatura_cartao_id = p_fatura_id
       and a.status = 'aprovada'
     order by a.data_prevista_pagamento, a.created_at
  loop
    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, cliente_id, job_id, conta_avulsa_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id,
      origem, criado_por
    ) values (
      v_item.tenant_id, v_item.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, v_item.valor,
      v_item.natureza, 'Cartão · ' || substring(v_item.descricao, 1, 180),
      v_item.plano_conta_tipo_id, v_item.plano_conta_subtipo_id,
      v_item.fornecedor_id, v_item.cliente_id, v_item.job_id, v_item.id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id,
      'avulsa_baixa', v_caller_uid
    );

    update contas_avulsas
       set status = 'baixada',
           pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid,
           conta_bancaria_baixa_id = v_conta.id
     where id = v_item.id;

    v_soma := v_soma + v_item.valor;
  end loop;

  v_diferenca := p_valor_cobrado - v_soma;

  if abs(v_diferenca) > 0.005 then
    if p_ajuste_tipo_id is null or p_ajuste_subtipo_id is null then
      raise exception
        'A fatura fecha em % e o banco cobrou % — diferença de %. Informe o plano de contas do ajuste (IOF, anuidade, juros) ou lance o que está faltando antes de fechar.',
        to_char(v_soma, 'FM999999999990.00'),
        to_char(p_valor_cobrado, 'FM999999999990.00'),
        to_char(v_diferenca, 'FM999999999990.00');
    end if;

    select tipo_id into v_subtipo_tipo
      from plano_contas_subtipos where id = p_ajuste_subtipo_id;
    if not found then raise exception 'Subtipo do ajuste não encontrado.'; end if;
    if v_subtipo_tipo <> p_ajuste_tipo_id then
      raise exception 'Subtipo do ajuste não pertence ao tipo escolhido.';
    end if;

    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id,
      origem, criado_por
    ) values (
      v_fatura.tenant_id, v_conta.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, abs(v_diferenca),
      case when v_diferenca > 0 then 'saida' else 'entrada' end,
      coalesce(nullif(btrim(p_ajuste_descricao), ''), 'Ajuste da fatura ' || v_fatura.codigo),
      p_ajuste_tipo_id, p_ajuste_subtipo_id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id,
      'manual', v_caller_uid
    );
  end if;

  update faturas_cartao
     set status = 'fechada', valor_cobrado = p_valor_cobrado,
         fechada_em = now(), fechada_por = v_caller_uid
   where id = p_fatura_id;

  return p_fatura_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- O pagamento: qualquer conta ativa do tenant paga
-- ---------------------------------------------------------------------

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
  if v_fatura.valor_cobrado is null or v_fatura.valor_cobrado <= 0 then
    raise exception 'Fatura sem valor cobrado. Feche-a informando o valor do banco.';
  end if;

  select * into v_cartao from cartoes_credito where id = v_fatura.cartao_credito_id;

  select * into v_conta_cartao from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  select * into v_conta_banco from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;

  -- A única trava de conta que sobra, e ela vale: pagar cartão com cartão
  -- só empurraria a dívida de um para o outro sem dinheiro sair de lugar
  -- nenhum.
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

  -- A empresa do lançamento é a de quem realmente pagou: a conta bancária.
  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_banco.empresa_id, p_conta_bancaria_id,
    p_pago_em, v_fatura.valor_cobrado, 'saida', v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'manual', v_caller_uid
  )
  returning id into v_lanc_banco;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_cartao.empresa_id, v_conta_cartao.id,
    p_pago_em, v_fatura.valor_cobrado, 'entrada', 'Pagamento da ' || v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'manual', v_caller_uid
  )
  returning id into v_lanc_cartao;

  update faturas_cartao set status = 'paga' where id = p_fatura_id;

  return array[v_lanc_banco, v_lanc_cartao];
end;
$function$;
