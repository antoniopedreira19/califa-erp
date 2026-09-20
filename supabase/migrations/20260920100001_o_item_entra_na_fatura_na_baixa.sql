-- =====================================================================
-- O item entra na fatura do cartão na CONFIRMAÇÃO do pagamento
-- (decisão 093).
--
-- Antes: o cartão escolhido na aprovação da PP (`rotear_pp_para_cartao`)
-- ou no cadastro da avulsa (gatilho `avulsa_entra_na_fatura`) já amarrava
-- o item a uma fatura; os itens viravam lançamento na conta-espelho só no
-- FECHAMENTO, e era o fechamento quem os marcava como pagos.
--
-- Agora: o cartão da aprovação/cadastro é INTENÇÃO (serve à previsão de
-- caixa). O item só entra na fatura quando o financeiro dá baixa nele
-- escolhendo a forma "cartão" — e nesse momento:
--   · a fatura é a do cartão escolhido, pela DATA DO PAGAMENTO informada
--     (`fatura_aberta_do_cartao`: antes do fechamento entra na fatura em
--     curso, depois na seguinte, e se aquela competência já fechou rola);
--   · o item vira lançamento na conta-espelho do cartão NA HORA, com a
--     data do pagamento, `papel_na_fatura = 'item'` e `fatura_cartao_id`;
--   · o item fica PAGO (para o fornecedor, foi pago no cartão);
--   · nada sai da conta bancária — o dinheiro sai na baixa da fatura.
--
-- Regra que organiza tudo: **pertencer a uma fatura é ter um lançamento
-- 'item'/'ajuste' na conta-espelho com aquele `fatura_cartao_id`.** A
-- coluna `fatura_cartao_id` da avulsa/parcela é um ponteiro mantido em
-- sincronia, não a fonte.
--
-- O que segue funcionando por caminhos próprios:
--   · Estorno de compra (avulsa com `estorno_de_avulsa_id`): é fato do
--     cartão, não intenção — entra na fatura aberta na hora em que nasce
--     (gatilho AFTER INSERT novo), como crédito.
--   · Ajuste do fechamento (IOF, anuidade…): nasce dentro do fechamento,
--     já na fatura, com `papel_na_fatura = 'ajuste'`.
--   · O que já estava roteado antes desta migration (parcela/avulsa com
--     fatura e sem lançamento) fica como está e é convertido no
--     fechamento, como sempre foi — "o que já está roteado fica como está"
--     (Tiago, 18/09/2026). Nenhum dado é alterado aqui.
--
-- Mudanças, todas em função/gatilho (aditivo — nenhuma coluna, nenhuma
-- linha tocada):
--   1. `cartao_lancar_item` — o helper que põe um item numa fatura.
--   2. `avulsa_entra_na_fatura` — deixa de rotear no cadastro.
--   3. `avulsa_estorno_lanca_no_cartao` — gatilho novo para o estorno.
--   4. `dar_baixa_pp_parcela`, `dar_baixa_avulsa_com_plano`,
--      `dar_baixa_desembolso_parcela` — ganham o caminho do cartão.
--   5. `fechar_fatura_cartao` — soma o que já é lançamento e converte só o
--      legado; o ajuste entra pelo helper.
--   6. `reabrir_fatura_cartao` — desfaz só os ajustes; item confirmado é
--      baixa, e baixa se desfaz por estorno.
--   7. `estornar_baixa_pp_parcela`, `estornar_baixa_avulsa`,
--      `estornar_baixa_desembolso_parcela` — item em fatura ABERTA sai da
--      fatura (o lançamento é apagado); em fatura fechada/paga, recusa.
--
-- `rotear_pp_para_cartao` fica no banco, sem chamador: a aprovação passa
-- a gravar só a intenção na PP.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O helper: põe um item numa fatura do cartão.
-- ---------------------------------------------------------------------
create or replace function public.cartao_lancar_item(
  p_tenant_id          uuid,
  p_empresa_id         uuid,
  p_cartao_id          uuid,
  p_data               date,
  p_valor              numeric,
  p_natureza           natureza_lancamento,
  p_descricao          text,
  p_tipo_id            uuid,
  p_subtipo_id         uuid,
  p_fornecedor_id      uuid,
  p_cliente_id         uuid,
  p_job_id             uuid,
  p_conta_avulsa_id    uuid,
  p_pedido_compra_id   uuid,
  p_pp_parcela_id      uuid,
  p_desembolso_id      uuid,
  p_desembolso_parcela_id uuid,
  p_origem             origem_lancamento,
  p_papel              text,
  p_criado_por         uuid,
  p_fatura_id          uuid default null,
  out lancamento_id    uuid,
  out fatura_id        uuid,
  out conta_espelho_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cartao   cartoes_credito%rowtype;
  v_conta    contas_bancarias%rowtype;
  v_status   fatura_cartao_status;
  v_fcartao  uuid;
begin
  select * into v_cartao from cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado.'; end if;
  if v_cartao.tenant_id <> p_tenant_id then
    raise exception 'Cartão de outro tenant.';
  end if;
  if not v_cartao.ativo then
    raise exception 'O cartão % está inativo.', v_cartao.nome;
  end if;

  select * into v_conta from contas_bancarias
   where cartao_credito_id = p_cartao_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  if p_papel not in ('item', 'ajuste') then
    raise exception 'Papel inválido para item de fatura: %.', p_papel;
  end if;

  if p_fatura_id is null then
    -- A data do pagamento decide a fatura: antes do dia de fechamento,
    -- a que está em curso; depois, a seguinte; competência já fechada
    -- rola para a próxima aberta.
    fatura_id := public.fatura_aberta_do_cartao(p_cartao_id, p_data);
  else
    select status, cartao_credito_id into v_status, v_fcartao
      from faturas_cartao where id = p_fatura_id;
    if not found then raise exception 'Fatura não encontrada.'; end if;
    if v_fcartao <> p_cartao_id then
      raise exception 'A fatura não é deste cartão.';
    end if;
    if v_status <> 'aberta' then
      raise exception 'Só fatura aberta recebe item (status atual: %).', v_status;
    end if;
    fatura_id := p_fatura_id;
  end if;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    conta_avulsa_id, pedido_compra_id, pedido_compra_parcela_id,
    desembolso_id, desembolso_parcela_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
    origem, criado_por
  ) values (
    p_tenant_id, p_empresa_id, v_conta.id, p_data, p_valor,
    p_natureza, p_descricao, p_tipo_id, p_subtipo_id,
    p_fornecedor_id, p_cliente_id, p_job_id,
    p_conta_avulsa_id, p_pedido_compra_id, p_pp_parcela_id,
    p_desembolso_id, p_desembolso_parcela_id,
    'cartao_credito', p_cartao_id, fatura_id, p_papel,
    p_origem, p_criado_por
  )
  returning id into lancamento_id;

  conta_espelho_id := v_conta.id;
end;
$$;

comment on function public.cartao_lancar_item is
  'Põe um item numa fatura do cartão: escolhe a fatura pela data (ou usa a informada), cria o lançamento na conta-espelho com papel item/ajuste e devolve lançamento, fatura e conta. Só é chamado de dentro de outras funções (decisão 093).';

revoke all on function public.cartao_lancar_item from public;
revoke all on function public.cartao_lancar_item from anon;
revoke all on function public.cartao_lancar_item from authenticated;

-- ---------------------------------------------------------------------
-- 2. O cadastro da avulsa não roteia mais.
-- ---------------------------------------------------------------------
create or replace function public.avulsa_entra_na_fatura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  fatura_cartao_status;
  v_fcartao uuid;
  v_venc    date;
begin
  if new.forma_pagamento is distinct from 'cartao_credito'
     or new.cartao_credito_id is null then
    new.fatura_cartao_id := null;
    return new;
  end if;

  -- 093: intenção não é vínculo. No UPDATE, o que a baixa (ou o
  -- fechamento) gravou fica como está.
  if tg_op = 'UPDATE' then
    return new;
  end if;

  -- INSERT: a avulsa nasce SEM fatura. A exceção é quem já nasce dentro
  -- de uma — o ajuste do fechamento, que vem com a fatura informada e
  -- precisa que ela exista, seja deste cartão e esteja aberta.
  if new.fatura_cartao_id is not null then
    select status, cartao_credito_id into v_status, v_fcartao
      from faturas_cartao where id = new.fatura_cartao_id;
    if not found or v_fcartao <> new.cartao_credito_id or v_status <> 'aberta' then
      raise exception 'A avulsa aponta para uma fatura que não é deste cartão ou não está aberta.';
    end if;
  end if;

  -- Sem data prevista (o cadastro deixa o campo opcional porque, no
  -- cartão, era o gatilho quem a preenchia), a intenção ganha a melhor
  -- estimativa: o vencimento da fatura em que a compra cairia. É só o
  -- padrão de um campo vazio — a fatura de verdade continua sendo
  -- decidida na baixa.
  if new.data_prevista_pagamento is null then
    v_venc := public.proxima_fatura_cartao(
      new.cartao_credito_id, coalesce(new.data_compra, current_date));
    new.data_prevista_pagamento := v_venc;
    new.data_pagamento := coalesce(new.data_pagamento, v_venc);
    new.data_pagamento_primeira := coalesce(new.data_pagamento_primeira, v_venc);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. O estorno de compra entra na fatura aberta na hora em que nasce.
-- ---------------------------------------------------------------------
create or replace function public.avulsa_estorno_lanca_no_cartao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res  record;
  v_data date;
  v_venc date;
  v_quem uuid;
begin
  if new.estorno_de_avulsa_id is null
     or new.forma_pagamento is distinct from 'cartao_credito'
     or new.cartao_credito_id is null
     or new.status = 'baixada' then
    return new;
  end if;

  v_data := coalesce(new.data_compra, current_date);
  v_quem := coalesce(auth.uid(), new.criado_por);

  select * into v_res from public.cartao_lancar_item(
    new.tenant_id, new.empresa_id, new.cartao_credito_id, v_data,
    new.valor, new.natureza,
    'Estorno · ' || substring(new.descricao, 1, 180),
    new.plano_conta_tipo_id, new.plano_conta_subtipo_id,
    new.fornecedor_id, new.cliente_id, new.job_id,
    new.id, null, null, null, null,
    'avulsa_baixa', 'item', v_quem, null
  );

  -- O estorno nasce sem data prevista (a tela não a pede); ela passa a
  -- ser o vencimento da fatura em que ele entrou, como era antes.
  select data_vencimento into v_venc from faturas_cartao where id = v_res.fatura_id;

  update contas_avulsas
     set status = 'baixada',
         pago_em = v_data,
         pago_por = v_quem,
         conta_bancaria_baixa_id = v_res.conta_espelho_id,
         fatura_cartao_id = v_res.fatura_id,
         data_prevista_pagamento = coalesce(data_prevista_pagamento, v_venc),
         data_pagamento = coalesce(data_pagamento, v_venc),
         data_pagamento_primeira = coalesce(data_pagamento_primeira, v_venc)
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_avulsa_estorno_lanca_no_cartao on public.contas_avulsas;
create trigger trg_avulsa_estorno_lanca_no_cartao
  after insert on public.contas_avulsas
  for each row execute function public.avulsa_estorno_lanca_no_cartao();

-- ---------------------------------------------------------------------
-- 4a. Baixa de parcela de PP.
-- ---------------------------------------------------------------------
create or replace function public.dar_baixa_pp_parcela(
  p_parcela_id uuid, p_pago_em date, p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid, p_criado_por uuid,
  p_forma_pagamento forma_pagamento, p_cartao_credito_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        pedidos_compra_parcelas%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
  v_res            record;
begin
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_parcela from pedidos_compra_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  -- Legado (roteada na aprovação, antes da 093): espera o fechamento.
  if v_parcela.fatura_cartao_id is not null then
    raise exception 'Parcela paga no cartão não se baixa sozinha: ela espera na aba Cartão e sai na baixa da fatura inteira.';
  end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_pp from pedidos_compra where id = v_parcela.pedido_compra_id;
  if v_pp.status <> 'aprovada' then
    raise exception 'A PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total from pedidos_compra_parcelas where pedido_compra_id = v_pp.id;

  if p_forma_pagamento = 'cartao_credito' then
    -- 093: o item entra na fatura do cartão pela data informada. Nada sai
    -- da conta bancária — o dinheiro sai na baixa da fatura.
    v_descricao := 'Cartão · PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_pp.servico, 1, 140);

    select * into v_res from public.cartao_lancar_item(
      v_pp.tenant_id, v_pp.empresa_id, p_cartao_credito_id, p_pago_em,
      v_parcela.valor, 'saida', v_descricao,
      p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
      v_pp.fornecedor_id, null, v_pp.job_id,
      null, v_pp.id, v_parcela.id, null, null,
      'pp_baixa', 'item', p_criado_por, null
    );
    v_lancamento_id := v_res.lancamento_id;

    update pedidos_compra_parcelas
       set pago_em = p_pago_em, pago_por = p_criado_por,
           fatura_cartao_id = v_res.fatura_id
     where id = p_parcela_id;
  else
    select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
    if not found then raise exception 'Conta bancária não encontrada.'; end if;
    if v_conta.cartao_credito_id is not null then
      raise exception 'A conta espelho de um cartão não paga título direto — escolha a forma "cartão de crédito".';
    end if;
    -- Sem trava de empresa: a conta paga despesa de mais de uma
    -- empresa (29/08/2026). Quem diz a empresa é o documento.
    if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
    if p_pago_em < v_conta.saldo_inicial_data then
      raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
    end if;

    update pedidos_compra_parcelas
       set pago_em = p_pago_em, pago_por = p_criado_por
     where id = p_parcela_id;

    v_descricao := 'PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_pp.servico, 1, 140);

    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
      forma_pagamento, cartao_credito_id,
      origem, criado_por
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
      'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
      v_pp.fornecedor_id, v_pp.job_id, v_pp.id, v_parcela.id,
      p_forma_pagamento, null,
      'pp_baixa', p_criado_por
    )
    returning id into v_lancamento_id;
  end if;

  select count(*)::int into v_em_aberto
    from pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id and pago_em is null;

  if v_em_aberto = 0 then
    update pedidos_compra
       set status = 'pago', pago_em = p_pago_em, pago_por = p_criado_por
     where id = v_pp.id;
  end if;

  return v_lancamento_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4b. Baixa de conta avulsa / recorrência.
-- ---------------------------------------------------------------------
create or replace function public.dar_baixa_avulsa_com_plano(
  p_conta_avulsa_id uuid, p_pago_em date, p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid,
  p_forma_pagamento forma_pagamento, p_cartao_credito_id uuid default null
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
  v_subtipo_tipo   uuid;
  v_descricao      text;
  v_lancamento_id  uuid;
  v_res            record;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
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

  -- Legado (roteada no cadastro, antes da 093): espera o fechamento.
  if v_avulsa.fatura_cartao_id is not null then
    raise exception 'Item pago no cartão não se baixa sozinho: ele espera na aba Cartão e sai na baixa da fatura inteira.';
  end if;

  if v_avulsa.estorno_de_avulsa_id is not null then
    raise exception 'Estorno de compra não tem baixa própria: ele já entra na fatura quando é lançado.';
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  if p_forma_pagamento = 'cartao_credito' then
    v_descricao := 'Cartão · ' || substring(v_avulsa.descricao, 1, 180);

    select * into v_res from public.cartao_lancar_item(
      v_avulsa.tenant_id, v_avulsa.empresa_id, p_cartao_credito_id, p_pago_em,
      v_avulsa.valor, v_avulsa.natureza, v_descricao,
      p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
      v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id,
      v_avulsa.id, null, null, null, null,
      'avulsa_baixa', 'item', v_caller_uid, null
    );
    v_lancamento_id := v_res.lancamento_id;

    update contas_avulsas
       set status = 'baixada', pago_em = p_pago_em, pago_por = v_caller_uid,
           conta_bancaria_baixa_id = v_res.conta_espelho_id,
           forma_pagamento = 'cartao_credito',
           cartao_credito_id = p_cartao_credito_id,
           fatura_cartao_id = v_res.fatura_id
     where id = p_conta_avulsa_id;

    return v_lancamento_id;
  end if;

  select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.cartao_credito_id is not null then
    raise exception 'A conta espelho de um cartão não paga título direto — escolha a forma "cartão de crédito".';
  end if;
  if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
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
    p_forma_pagamento, null,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4c. Baixa de parcela de desembolso.
-- ---------------------------------------------------------------------
create or replace function public.dar_baixa_desembolso_parcela(
  p_parcela_id uuid, p_pago_em date, p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid, p_criado_por uuid,
  p_forma_pagamento forma_pagamento, p_cartao_credito_id uuid default null
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
  v_res            record;
begin
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;
  if v_desembolso.status <> 'aprovada' then
    raise exception 'O desembolso precisa estar aprovado antes da baixa (status atual: %).', v_desembolso.status;
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total from desembolsos_parcelas where desembolso_id = v_desembolso.id;

  if p_forma_pagamento = 'cartao_credito' then
    v_descricao := 'Cartão · Desembolso ' || v_desembolso.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_desembolso.descricao, 1, 140);

    select * into v_res from public.cartao_lancar_item(
      v_desembolso.tenant_id, v_desembolso.empresa_id, p_cartao_credito_id, p_pago_em,
      v_parcela.valor, 'saida', v_descricao,
      p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
      v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
      null, null, null, v_desembolso.id, v_parcela.id,
      'desembolso_baixa', 'item', p_criado_por, null
    );
    v_lancamento_id := v_res.lancamento_id;

    update desembolsos_parcelas
       set pago_em = p_pago_em, pago_por = p_criado_por
     where id = p_parcela_id;
  else
    select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
    if not found then raise exception 'Conta bancária não encontrada.'; end if;
    if v_conta.cartao_credito_id is not null then
      raise exception 'A conta espelho de um cartão não paga título direto — escolha a forma "cartão de crédito".';
    end if;
    if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
    if p_pago_em < v_conta.saldo_inicial_data then
      raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
    end if;

    update desembolsos_parcelas
       set pago_em = p_pago_em, pago_por = p_criado_por
     where id = p_parcela_id;

    v_descricao := 'Desembolso ' || v_desembolso.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_desembolso.descricao, 1, 140);

    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, cliente_id, job_id,
      desembolso_id, desembolso_parcela_id,
      forma_pagamento, cartao_credito_id,
      origem, criado_por
    ) values (
      v_desembolso.tenant_id, v_desembolso.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
      'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
      v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
      v_desembolso.id, v_parcela.id,
      p_forma_pagamento, null,
      'desembolso_baixa', p_criado_por
    )
    returning id into v_lancamento_id;
  end if;

  select count(*)::int into v_em_aberto
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id and pago_em is null;

  if v_em_aberto = 0 then
    update desembolsos
       set status = 'pago', pago_em = now(), pago_por = p_criado_por
     where id = v_desembolso.id;
  end if;

  return v_lancamento_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Fechar a fatura: soma o que já é lançamento, converte só o legado.
-- ---------------------------------------------------------------------
create or replace function public.fechar_fatura_cartao(
  p_fatura_id uuid, p_valor_cobrado numeric, p_ajustes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid   uuid;
  v_fatura       faturas_cartao%rowtype;
  v_conta        contas_bancarias%rowtype;
  v_item         record;
  v_pp           record;
  v_aj           record;
  v_res          record;
  v_em_aberto    integer;
  v_soma         numeric := 0;
  v_prevista     numeric := 0;
  v_diferenca    numeric;
  v_ajustado     numeric := 0;
  v_subtipo_tipo uuid;
  v_avulsa_id    uuid;
  v_avulsa       contas_avulsas%rowtype;
  v_quantos      integer := 0;
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

  if p_valor_cobrado is null then
    raise exception 'Informe o valor cobrado pelo banco nesta fatura.';
  end if;

  select * into v_conta from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  -- ------------------------------------------------------------------
  -- Quanto a fatura soma ANTES de qualquer ajuste: o que já é lançamento
  -- (itens confirmados na baixa, estornos, ajustes de fechamento anterior)
  -- mais o legado ainda pendente (roteado antes da 093, sem lançamento).
  -- ------------------------------------------------------------------
  select coalesce(sum(case when l.natureza = 'entrada' then -l.valor else l.valor end), 0)
    into v_prevista
    from lancamentos_financeiros l
   where l.fatura_cartao_id = p_fatura_id
     and l.papel_na_fatura in ('item', 'ajuste');

  v_prevista := v_prevista + coalesce((
    select sum(case when a.natureza = 'entrada' then -a.valor else a.valor end)
      from contas_avulsas a
     where a.fatura_cartao_id = p_fatura_id
       and a.status = 'aprovada'
       and not exists (select 1 from lancamentos_financeiros l
                        where l.conta_avulsa_id = a.id
                          and l.fatura_cartao_id = p_fatura_id
                          and l.papel_na_fatura in ('item', 'ajuste'))
  ), 0);

  v_prevista := v_prevista + coalesce((
    select sum(par.valor)
      from pedidos_compra_parcelas par
     where par.fatura_cartao_id = p_fatura_id
       and par.pago_em is null
  ), 0);

  v_diferenca := p_valor_cobrado - v_prevista;

  -- ------------------------------------------------------------------
  -- A diferença vira compra — uma ou várias, cada uma com o seu rateio —
  -- e entra na fatura na hora, com papel 'ajuste'.
  -- ------------------------------------------------------------------
  if abs(v_diferenca) > 0.005 then
    if p_ajustes is null
       or jsonb_typeof(p_ajustes) <> 'array'
       or jsonb_array_length(p_ajustes) = 0 then
      raise exception
        'A fatura fecha em % e o banco cobrou % — diferença de %. Registre o que falta (IOF, anuidade, juros ou compra que ninguém lançou) antes de fechar.',
        to_char(v_prevista, 'FM999999999990.00'),
        to_char(p_valor_cobrado, 'FM999999999990.00'),
        to_char(v_diferenca, 'FM999999999990.00');
    end if;

    if v_diferenca < 0 then
      raise exception
        'O banco cobrou % e as compras somam % — % a menos. Diferença para baixo é estorno: registre o estorno da compra correspondente (botão Estornar, na compra) e feche de novo.',
        to_char(p_valor_cobrado, 'FM999999999990.00'),
        to_char(v_prevista, 'FM999999999990.00'),
        to_char(abs(v_diferenca), 'FM999999999990.00');
    end if;

    for v_aj in
      select x.descricao, x.tipo_id, x.subtipo_id, x.valor, x.rateio
        from jsonb_to_recordset(p_ajustes)
          as x(descricao text, tipo_id uuid, subtipo_id uuid, valor numeric, rateio jsonb)
    loop
      v_quantos := v_quantos + 1;

      if v_aj.valor is null or v_aj.valor <= 0 then
        raise exception 'O item % do ajuste precisa de um valor maior que zero.', v_quantos;
      end if;

      if v_aj.tipo_id is null or v_aj.subtipo_id is null then
        raise exception 'O item % do ajuste precisa de tipo e subtipo do plano de contas.', v_quantos;
      end if;

      select s.tipo_id into v_subtipo_tipo
        from plano_contas_subtipos s where s.id = v_aj.subtipo_id;
      if not found then
        raise exception 'Subtipo do item % do ajuste não encontrado.', v_quantos;
      end if;
      if v_subtipo_tipo <> v_aj.tipo_id then
        raise exception 'Subtipo do item % do ajuste não pertence ao tipo escolhido.', v_quantos;
      end if;

      -- Nasce como compra do cartão, JÁ nesta fatura (o gatilho de
      -- cadastro confere que ela é deste cartão e está aberta).
      v_avulsa_id := public.criar_conta_avulsa(
        jsonb_build_object(
          'tenant_id', v_fatura.tenant_id,
          'codigo', public.gerar_codigo_avulsa(v_fatura.tenant_id),
          'empresa_id', v_conta.empresa_id,
          'descricao', coalesce(nullif(btrim(v_aj.descricao), ''),
                                'Ajuste da fatura ' || v_fatura.codigo),
          'valor', v_aj.valor,
          'natureza', 'saida',
          'plano_conta_tipo_id', v_aj.tipo_id,
          'plano_conta_subtipo_id', v_aj.subtipo_id,
          'forma_pagamento', 'cartao_credito',
          'cartao_credito_id', v_fatura.cartao_credito_id,
          'fatura_cartao_id', p_fatura_id,
          'data_compra', v_fatura.competencia_fechamento,
          'data_prevista_pagamento', v_fatura.data_vencimento,
          'data_pagamento', v_fatura.data_vencimento,
          'criado_por', v_caller_uid,
          'aprovada_em', now(),
          'aprovada_por', v_caller_uid
        ),
        coalesce(v_aj.rateio, '[]'::jsonb)
      );

      select * into v_avulsa from contas_avulsas where id = v_avulsa_id;

      select * into v_res from public.cartao_lancar_item(
        v_avulsa.tenant_id, v_avulsa.empresa_id, v_fatura.cartao_credito_id,
        v_fatura.competencia_fechamento, v_avulsa.valor, 'saida',
        'Cartão · ' || substring(v_avulsa.descricao, 1, 180),
        v_avulsa.plano_conta_tipo_id, v_avulsa.plano_conta_subtipo_id,
        null, null, null,
        v_avulsa.id, null, null, null, null,
        'avulsa_baixa', 'ajuste', v_caller_uid, p_fatura_id
      );

      update contas_avulsas
         set status = 'baixada',
             pago_em = v_fatura.competencia_fechamento,
             pago_por = v_caller_uid,
             conta_bancaria_baixa_id = v_conta.id
       where id = v_avulsa_id;

      v_ajustado := v_ajustado + v_aj.valor;
    end loop;

    if abs(v_ajustado - v_diferenca) > 0.005 then
      raise exception
        'Os itens do ajuste somam % e a diferença é %. Os valores precisam fechar a diferença exatamente.',
        to_char(v_ajustado, 'FM999999999990.00'),
        to_char(v_diferenca, 'FM999999999990.00');
    end if;

  elsif p_ajustes is not null
        and jsonb_typeof(p_ajustes) = 'array'
        and jsonb_array_length(p_ajustes) > 0 then
    raise exception
      'A fatura já fecha no valor cobrado (%) — não há diferença para registrar.',
      to_char(p_valor_cobrado, 'FM999999999990.00');
  end if;

  -- ------------------------------------------------------------------
  -- Legado: item roteado antes da 093 (na fatura, sem lançamento) vira
  -- lançamento agora, como o fechamento sempre fez.
  -- ------------------------------------------------------------------
  for v_item in
    select a.*
      from contas_avulsas a
     where a.fatura_cartao_id = p_fatura_id
       and a.status = 'aprovada'
       and not exists (select 1 from lancamentos_financeiros l
                        where l.conta_avulsa_id = a.id
                          and l.fatura_cartao_id = p_fatura_id
                          and l.papel_na_fatura in ('item', 'ajuste'))
     order by a.data_prevista_pagamento, a.created_at
  loop
    perform public.cartao_lancar_item(
      v_item.tenant_id, v_item.empresa_id, v_fatura.cartao_credito_id,
      v_fatura.competencia_fechamento, v_item.valor, v_item.natureza,
      case when v_item.estorno_de_avulsa_id is not null
           then 'Estorno · ' else 'Cartão · ' end
        || substring(v_item.descricao, 1, 180),
      v_item.plano_conta_tipo_id, v_item.plano_conta_subtipo_id,
      v_item.fornecedor_id, v_item.cliente_id, v_item.job_id,
      v_item.id, null, null, null, null,
      'avulsa_baixa', 'item', v_caller_uid, p_fatura_id
    );

    update contas_avulsas
       set status = 'baixada',
           pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid,
           conta_bancaria_baixa_id = v_conta.id
     where id = v_item.id;
  end loop;

  for v_pp in
    select par.id      as parcela_id,
           par.numero  as parcela_numero,
           par.valor   as parcela_valor,
           pc.id       as pp_id,
           pc.codigo   as pp_codigo,
           pc.servico  as pp_servico,
           pc.tenant_id, pc.empresa_id, pc.fornecedor_id, pc.job_id,
           pc.plano_conta_tipo_id, pc.plano_conta_subtipo_id,
           (select count(*) from pedidos_compra_parcelas x
             where x.pedido_compra_id = pc.id) as total_parcelas
      from pedidos_compra_parcelas par
      join pedidos_compra pc on pc.id = par.pedido_compra_id
     where par.fatura_cartao_id = p_fatura_id
       and par.pago_em is null
     order by pc.codigo, par.numero
  loop
    perform public.cartao_lancar_item(
      v_pp.tenant_id, v_pp.empresa_id, v_fatura.cartao_credito_id,
      v_fatura.competencia_fechamento, v_pp.parcela_valor, 'saida',
      'Cartão · PP ' || v_pp.pp_codigo || ' '
        || v_pp.parcela_numero || '/' || v_pp.total_parcelas
        || ' — ' || substring(v_pp.pp_servico, 1, 140),
      v_pp.plano_conta_tipo_id, v_pp.plano_conta_subtipo_id,
      v_pp.fornecedor_id, null, v_pp.job_id,
      null, v_pp.pp_id, v_pp.parcela_id, null, null,
      'pp_baixa', 'item', v_caller_uid, p_fatura_id
    );

    update pedidos_compra_parcelas
       set pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid
     where id = v_pp.parcela_id;

    select count(*)::int into v_em_aberto
      from pedidos_compra_parcelas
     where pedido_compra_id = v_pp.pp_id and pago_em is null;

    if v_em_aberto = 0 then
      update pedidos_compra
         set status = 'pago',
             pago_em = v_fatura.competencia_fechamento,
             pago_por = v_caller_uid
       where id = v_pp.pp_id;
    end if;
  end loop;

  -- Com tudo dentro, a soma dos lançamentos tem que bater com o extrato.
  select coalesce(sum(case when l.natureza = 'entrada' then -l.valor else l.valor end), 0)
    into v_soma
    from lancamentos_financeiros l
   where l.fatura_cartao_id = p_fatura_id
     and l.papel_na_fatura in ('item', 'ajuste');

  if abs(p_valor_cobrado - v_soma) > 0.005 then
    raise exception
      'Fechamento inconsistente: os itens somam % e o banco cobrou %. Nada foi gravado.',
      to_char(v_soma, 'FM999999999990.00'),
      to_char(p_valor_cobrado, 'FM999999999990.00');
  end if;

  update faturas_cartao
     set status = 'fechada', valor_cobrado = p_valor_cobrado,
         fechada_em = now(), fechada_por = v_caller_uid
   where id = p_fatura_id;

  return p_fatura_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Reabrir a fatura desfaz só os ajustes. Item confirmado é baixa.
-- ---------------------------------------------------------------------
create or replace function public.reabrir_fatura_cartao(p_fatura_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid uuid;
  v_fatura     faturas_cartao%rowtype;
  v_apagados   integer;
  v_voltaram   integer;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Diga por que a fatura está sendo reaberta.';
  end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status = 'aberta' then
    raise exception 'A fatura % já está aberta.', v_fatura.codigo;
  end if;
  if v_fatura.status = 'paga' then
    raise exception
      'A fatura % já foi paga. Estorne a baixa dela primeiro — reabrir sem isso deixaria o extrato do banco com um pagamento sem fatura.',
      v_fatura.codigo;
  end if;

  -- 093: os itens confirmados na baixa FICAM — são pagamentos feitos, e
  -- pagamento se desfaz por estorno da baixa, não por reabertura. O que
  -- a reabertura desfaz é o que o fechamento criou: os ajustes. As
  -- avulsas deles voltam a "aprovada", ainda apontando para a fatura,
  -- para o próximo fechamento reaproveitá-las sem redigitar.
  update contas_avulsas a
     set status = 'aprovada',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null
   where a.fatura_cartao_id = p_fatura_id
     and a.status = 'baixada'
     and exists (select 1 from lancamentos_financeiros l
                  where l.conta_avulsa_id = a.id
                    and l.fatura_cartao_id = p_fatura_id
                    and l.papel_na_fatura = 'ajuste');
  get diagnostics v_voltaram = row_count;

  delete from lancamentos_financeiros
   where fatura_cartao_id = p_fatura_id
     and papel_na_fatura = 'ajuste';
  get diagnostics v_apagados = row_count;

  update faturas_cartao
     set status = 'aberta',
         valor_cobrado = null,
         fechada_em = null,
         fechada_por = null
   where id = p_fatura_id;

  insert into audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_fatura.tenant_id, 'fatura_cartao', p_fatura_id::text,
    'fatura_cartao.reaberta', v_caller_uid,
    jsonb_build_object(
      'codigo', v_fatura.codigo,
      'motivo', btrim(p_motivo),
      'valor_cobrado_anterior', v_fatura.valor_cobrado,
      'ajustes_apagados', v_apagados,
      'ajustes_reabertos', v_voltaram
    )
  );

  return p_fatura_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Estornar a baixa de um item que está numa fatura.
-- ---------------------------------------------------------------------
create or replace function public.estornar_baixa_pp_parcela(
  p_parcela_id uuid, p_motivo text, p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela    pedidos_compra_parcelas%rowtype;
  v_pp         pedidos_compra%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_fatura     faturas_cartao%rowtype;
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

  -- 093: item de fatura. Na fatura ABERTA ele simplesmente sai dela —
  -- nada aconteceu no banco. Fechada ou paga, a fatura é o que manda.
  if v_original.papel_na_fatura = 'item' and v_original.fatura_cartao_id is not null then
    select * into v_fatura from public.faturas_cartao where id = v_original.fatura_cartao_id;
    if v_fatura.status <> 'aberta' then
      raise exception
        'Esta parcela está na fatura %, que já está %. Reabra a fatura (ou estorne o pagamento dela) antes de desfazer esta baixa.',
        v_fatura.codigo, v_fatura.status;
    end if;

    delete from public.lancamentos_financeiros where id = v_original.id;

    update public.pedidos_compra_parcelas
       set pago_em = null, pago_por = null, fatura_cartao_id = null
     where id = p_parcela_id;

    if v_pp.status = 'pago' then
      update public.pedidos_compra
         set status = 'aprovada', pago_em = null, pago_por = null
       where id = v_pp.id;
    end if;

    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_pp.tenant_id, 'pedido_compra', v_pp.id::text,
      'pedido_compra.parcela_saiu_da_fatura', p_criado_por,
      jsonb_build_object(
        'pp_codigo', v_pp.codigo, 'parcela_numero', v_parcela.numero,
        'fatura', v_fatura.codigo, 'motivo', btrim(p_motivo),
        'valor', v_parcela.valor
      )
    );

    return v_original.id;
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

create or replace function public.estornar_baixa_avulsa(p_conta_avulsa_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_original       lancamentos_financeiros%rowtype;
  v_fatura         faturas_cartao%rowtype;
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

  if v_avulsa.estorno_de_avulsa_id is not null then
    raise exception 'Estorno de compra não tem baixa própria para estornar.';
  end if;

  select * into v_original
    from public.lancamentos_financeiros
   where conta_avulsa_id = p_conta_avulsa_id and origem = 'avulsa_baixa'
   limit 1;
  if not found then raise exception 'Lançamento original não encontrado.'; end if;

  -- 093: item (ou ajuste) de fatura ABERTA sai dela; fechada ou paga, a
  -- fatura é o que manda.
  if v_original.papel_na_fatura in ('item', 'ajuste') and v_original.fatura_cartao_id is not null then
    select * into v_fatura from public.faturas_cartao where id = v_original.fatura_cartao_id;
    if v_fatura.status <> 'aberta' then
      raise exception
        'Este item está na fatura %, que já está %. Reabra a fatura (ou estorne o pagamento dela) antes de desfazer esta baixa.',
        v_fatura.codigo, v_fatura.status;
    end if;

    delete from public.lancamentos_financeiros where id = v_original.id;

    update public.contas_avulsas
       set status = 'aprovada',
           pago_em = null,
           pago_por = null,
           conta_bancaria_baixa_id = null,
           fatura_cartao_id = null
     where id = p_conta_avulsa_id;

    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_avulsa.tenant_id, 'conta_avulsa', v_avulsa.id::text,
      'conta_avulsa.saiu_da_fatura', v_caller_uid,
      jsonb_build_object(
        'codigo', v_avulsa.codigo, 'fatura', v_fatura.codigo,
        'motivo', btrim(p_motivo), 'valor', v_avulsa.valor
      )
    );

    return v_original.id;
  end if;

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

create or replace function public.estornar_baixa_desembolso_parcela(
  p_parcela_id uuid, p_motivo text, p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela         desembolsos_parcelas%rowtype;
  v_desembolso      desembolsos%rowtype;
  v_lanc_original   lancamentos_financeiros%rowtype;
  v_fatura          faturas_cartao%rowtype;
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

  select * into v_lanc_original
    from lancamentos_financeiros
   where desembolso_parcela_id = p_parcela_id
     and origem = 'desembolso_baixa'
     and cancelado_em is null
   limit 1;

  if not found then
    raise exception 'Lançamento de baixa da parcela não encontrado ou já estornado.';
  end if;

  -- 093: item de fatura ABERTA sai dela; fechada ou paga, recusa.
  if v_lanc_original.papel_na_fatura = 'item' and v_lanc_original.fatura_cartao_id is not null then
    select * into v_fatura from faturas_cartao where id = v_lanc_original.fatura_cartao_id;
    if v_fatura.status <> 'aberta' then
      raise exception
        'Esta parcela está na fatura %, que já está %. Reabra a fatura (ou estorne o pagamento dela) antes de desfazer esta baixa.',
        v_fatura.codigo, v_fatura.status;
    end if;

    delete from lancamentos_financeiros where id = v_lanc_original.id;

    update desembolsos_parcelas
       set pago_em = null, pago_por = null
     where id = p_parcela_id;

    if v_desembolso.status = 'pago' then
      update desembolsos
         set status = 'aprovada', pago_em = null, pago_por = null
       where id = v_desembolso.id;
    end if;

    return v_lanc_original.id;
  end if;

  update lancamentos_financeiros
     set origem        = 'desembolso_baixa_estornada',
         cancelado_em  = now(),
         cancelado_por = p_criado_por
   where id = v_lanc_original.id;

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

  update desembolsos_parcelas
     set pago_em  = null,
         pago_por = null
   where id = p_parcela_id;

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

comment on function public.rotear_pp_para_cartao(uuid, uuid, uuid, uuid) is
  'LEGADO (decisão 093, 20/09/2026): a aprovação não roteia mais parcela para fatura; o item entra na fatura na baixa. Fica no banco sem chamador.';
