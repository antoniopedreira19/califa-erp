-- =====================================================================
-- A conta bancária paga despesa de mais de uma empresa
--
-- Como estava: `fk_lancamento_conta_empresa` era uma FK COMPOSTA de
-- (conta_bancaria_id, empresa_id) para contas_bancarias(id, empresa_id).
-- O efeito prático é que todo lançamento tinha que carregar a empresa da
-- conta em que caía — ou seja, uma conta bancária pertencia a UMA empresa
-- e só pagava despesa dela. A mesma regra estava escrita de novo, em
-- texto, dentro de `dar_baixa_pp` e `dar_baixa_avulsa_com_plano`.
--
-- Por que muda: na California não é assim. Uma conta paga despesa de mais
-- de uma empresa — quem diz a empresa da despesa é o DOCUMENTO (a PP, a
-- avulsa, o item do cartão), não a conta de onde o dinheiro saiu.
-- Confirmado pelo Tiago em 28/08/2026.
--
-- Como ninguém tinha esbarrado nisso: só existe uma conta bancária real
-- (California Santander, da CALIFÓRNIA) e as 12 PPs são todas da mesma
-- empresa. O primeiro documento de outra empresa a chegar no fechamento
-- foi uma avulsa da HITLAB no cartão, e ela estourou a FK.
--
-- ⚠️ DESTRUTIVA. Derruba uma regra que a outra frente escreveu, numa
-- tabela com dado dela. Autorizada explicitamente pelo Tiago em
-- 28/08/2026, na conversa em que o erro apareceu.
--
-- O que NÃO muda: os lançamentos continuam saindo com a empresa do
-- documento — as duas funções já faziam isso (`v_pp.empresa_id`,
-- `v_avulsa.empresa_id`). Só a trava sai; a origem do dado é a mesma.
--
-- ⚠️ Fica de fora, de propósito: a mesma trava de texto existe em mais
-- seis funções da outra frente — dar_baixa_avulsa, dar_baixa_pp_parcela,
-- dar_baixa_titulo, dar_baixa_titulo_com_plano, dar_baixa_desembolso_parcela
-- e dar_baixa_devolucao_verba. Sem a FK elas não quebram nada, só seguem
-- recusando o cruzamento de empresas nos caminhos delas. Cada uma é um
-- caminho de pagamento com teste próprio e merece uma passada própria.
-- =====================================================================

-- 1. A FK composta sai. O índice único em contas_bancarias(id, empresa_id)
--    que existia para sustentá-la fica: ele é inofensivo e some sozinho se
--    alguém quiser limpar depois.
alter table public.lancamentos_financeiros
  drop constraint if exists fk_lancamento_conta_empresa;

-- 2. dar_baixa_pp — mesma função, sem a trava de empresa.
create or replace function public.dar_baixa_pp(
  p_pp_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;
  if v_pp.status <> 'aprovada' then
    raise exception 'PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  -- A empresa da conta não precisa mais bater com a da PP: uma conta paga
  -- despesa de mais de uma empresa (28/08/2026). A empresa do lançamento
  -- continua vindo da PP, logo abaixo.
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  update public.pedidos_compra
     set status = 'pago',
         pago_em = p_pago_em,
         pago_por = p_criado_por
   where id = p_pp_id;

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
$function$;

-- 3. dar_baixa_avulsa_com_plano — idem. As outras travas ficam todas:
--    cartão não se baixa sozinho, conta espelho não paga título direto,
--    conta inativa, data anterior ao saldo inicial.
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
  -- Sem trava de empresa: a conta paga despesa de mais de uma empresa
  -- (28/08/2026). A empresa do lançamento sai da avulsa.
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

-- 4. GRANTs — o Postgres dá EXECUTE para PUBLIC por default a cada
--    create or replace. Tira de todo mundo e devolve só para quem loga.
revoke execute on function public.dar_baixa_pp(uuid, date, uuid, uuid, uuid, uuid) from public;
grant execute on function public.dar_baixa_pp(uuid, date, uuid, uuid, uuid, uuid) to authenticated;

revoke execute on function public.dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant execute on function public.dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;
