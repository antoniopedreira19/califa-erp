-- Item no cartão não se baixa sozinho.
--
-- ⚠️ CORREÇÃO da migration 20260828150002, no mesmo dia. Eu tinha feito a
-- baixa INDIVIDUAL de uma avulsa com forma "cartão" criar o lançamento na
-- conta do cartão. Errado: no modelo combinado com o Tiago não existe baixa
-- individual de item no cartão.
--
-- O fluxo correto:
--   1. Avulsa com forma "cartão" vai para a ABA CARTÃO e espera lá.
--      (Isso já funcionava: a aba Cartão lista os títulos `a_pagar` com
--      forma cartão, e Títulos a Pagar lista o resto.)
--   2. No FECHAMENTO, a fatura vira UM título em Títulos a Pagar.
--   3. A baixa é desse título — UMA baixa —, quando o dinheiro sai da conta.
--
-- Ou seja: a baixa de um item de cartão não existe em momento nenhum. O que
-- se baixa é a fatura. Por isso a função passa a RECUSAR forma "cartão" em
-- vez de tratá-la.
--
-- `dar_baixa_lote_cartao` chama esta função e portanto também passa a
-- recusar. É intencional: ela baixava título a título contra o banco, que é
-- exatamente o que o modelo novo desfaz. O pagamento da fatura nasce no
-- passo 4, e é uma transferência banco -> cartão.
--
-- O que fica de 20260828150002: `faturas_cartao`, o vínculo
-- `lancamentos_financeiros.fatura_cartao_id` e `fatura_aberta_do_cartao`.
-- Nada disso muda — só o momento em que o lançamento nasce, que passa a ser
-- o fechamento (passo 3), e não a baixa.

create or replace function public.dar_baixa_avulsa_com_plano(
  p_conta_avulsa_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_forma_pagamento forma_pagamento,
  p_cartao_credito_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_descricao      text;
  v_lancamento_id  uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  -- A porta que este arquivo fecha.
  if p_forma_pagamento = 'cartao_credito' then
    raise exception 'Item pago no cartão não se baixa sozinho: ele espera na aba Cartão e sai na baixa da fatura inteira.';
  end if;
  if p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_avulsa from contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Só avulsa aprovada pode ser baixada (status atual: %).', v_avulsa.status;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.cartao_credito_id is not null then
    raise exception 'A conta espelho de um cartão não paga título direto — quem paga é a baixa da fatura.';
  end if;
  if v_conta.empresa_id <> v_avulsa.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da conta avulsa.';
  end if;
  if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  update contas_avulsas
     set status = 'baixada', pago_em = p_pago_em, pago_por = v_caller_uid,
         conta_bancaria_baixa_id = p_conta_bancaria_id
   where id = p_conta_avulsa_id;

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_avulsa.valor,
    v_avulsa.natureza, v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    p_forma_pagamento, p_cartao_credito_id,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$function$;
