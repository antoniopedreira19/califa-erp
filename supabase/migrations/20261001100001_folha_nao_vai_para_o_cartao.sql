-- =====================================================================
-- Folha não se paga com cartão de crédito
-- (revisão da decisão 125, Tiago, 01/10/2026)
-- =====================================================================
--
-- O "Baixar" de Títulos a Pagar oferecia "Cartão de crédito" também para o
-- título de folha, e esta função aceitava: o salário entraria na fatura do
-- cartão. O Tiago decidiu tirar o cartão da folha. A tela deixa de oferecer
-- a forma; a recusa fica aqui, junto das outras regras da folha (só o valor
-- inteiro, sem retenção — decisão 125, P1), para valer também para quem
-- chamar a função por fora da tela.
--
-- O corpo é o de 20260929800001, conferido contra o banco vivo em
-- 01/10/2026 (mesmo md5), com um único bloco a mais, antes de qualquer
-- escrita. `dar_baixa_avulsa` e `dar_baixa_avulsa_com_plano` delegam para
-- esta função e herdam a recusa.
--
-- Fica de fora: nada muda para avulso, recorrência, recebimento avulso e
-- rendimento. Nenhum dado é tocado: em 01/10/2026 nenhum título de folha
-- tinha baixa, no cartão ou fora dele.
-- =====================================================================

create or replace function public.baixar_conta_avulsa(
  p_conta_avulsa_id    uuid,
  p_pago_em            date,
  p_conta_bancaria_id  uuid,
  p_tipo_id            uuid,
  p_subtipo_id         uuid,
  p_forma_pagamento    forma_pagamento default null,
  p_cartao_credito_id  uuid default null,
  p_valor_baixa        numeric default null,
  p_retencoes          jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid            uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_baixado        numeric;
  v_aberto         numeric;
  v_valor          numeric;
  v_retido         numeric;
  v_descricao      text;
  v_lancamento_id  uuid;
  v_res            record;
begin
  if p_pago_em is null then
    raise exception 'Informe a data da baixa.';
  end if;
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id for update;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  v_uid := public._exige_financeiro_para_baixar(v_avulsa.tenant_id);

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Só avulsa aprovada pode ser baixada (status atual: %).', v_avulsa.status;
  end if;
  if v_avulsa.fatura_cartao_id is not null then
    raise exception 'Item pago no cartão não se baixa sozinho: ele espera na aba Cartão e sai na baixa da fatura inteira.';
  end if;
  if v_avulsa.estorno_de_avulsa_id is not null then
    raise exception 'Estorno de compra não tem baixa própria: ele já entra na fatura quando é lançado.';
  end if;
  -- Folha não vai para a fatura do cartão (Tiago, 01/10/2026): salário se
  -- paga por PIX ou TED, quase sempre pela remessa.
  if v_avulsa.folha_id is not null and p_forma_pagamento = 'cartao_credito' then
    raise exception 'Folha não se paga com cartão de crédito.';
  end if;

  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_baixado := public._bruto_baixado('avulsa_baixa', p_conta_avulsa_id);
  v_aberto := v_avulsa.valor - v_baixado;
  if v_aberto <= 0.004 then
    raise exception 'Esta conta já está quitada.';
  end if;
  v_valor := public._valor_da_baixa(p_valor_baixa, v_aberto);
  v_retido := public._retencoes_total(p_retencoes, v_valor);

  -- Onde só cabe o valor inteiro, sem retenção.
  if v_valor < v_aberto - 0.004 or v_retido > 0 then
    if v_avulsa.tipo_entrada = 'rendimento' then
      raise exception 'Rendimento só aceita a baixa do valor inteiro, sem retenção.';
    end if;
    if v_avulsa.folha_id is not null then
      raise exception 'Folha só aceita a baixa do valor inteiro, sem retenção.';
    end if;
    if p_forma_pagamento = 'cartao_credito' then
      raise exception 'No cartão, a baixa é sempre do valor inteiro: o item entra inteiro na fatura.';
    end if;
    if public._documento_em_remessa(p_conta_avulsa_id) then
      raise exception 'Pago pela remessa com o valor cheio: esta conta só aceita a baixa do que falta, sem retenção.';
    end if;
  end if;

  if p_forma_pagamento = 'cartao_credito' then
    if v_baixado > 0 then
      raise exception 'Esta conta já tem baixa parcial: o restante não vai para o cartão.';
    end if;

    v_descricao := 'Cartão · ' || substring(v_avulsa.descricao, 1, 180);

    select * into v_res from public.cartao_lancar_item(
      v_avulsa.tenant_id, v_avulsa.empresa_id, p_cartao_credito_id, p_pago_em,
      v_avulsa.valor, v_avulsa.natureza, v_descricao,
      p_tipo_id, p_subtipo_id,
      v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id,
      v_avulsa.id, null, null, null, null,
      'avulsa_baixa', 'item', v_uid, null
    );
    v_lancamento_id := v_res.lancamento_id;

    update public.contas_avulsas
       set status = 'baixada', pago_em = p_pago_em, pago_por = v_uid,
           conta_bancaria_baixa_id = v_res.conta_espelho_id,
           forma_pagamento = 'cartao_credito',
           cartao_credito_id = p_cartao_credito_id,
           fatura_cartao_id = v_res.fatura_id
     where id = p_conta_avulsa_id;

    return v_lancamento_id;
  end if;

  v_conta := public._conta_da_baixa(
    p_conta_bancaria_id, v_avulsa.tenant_id, p_pago_em,
    case when v_avulsa.natureza = 'entrada' then 'recebimento' else 'pagamento' end
  );

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_valor - v_retido,
    v_avulsa.natureza, v_descricao, p_tipo_id, p_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    p_forma_pagamento, null,
    'avulsa_baixa', v_uid
  )
  returning id into v_lancamento_id;

  perform public._retencoes_gravar(v_lancamento_id, v_avulsa.tenant_id, p_retencoes, v_uid);

  if v_baixado + v_valor >= v_avulsa.valor - 0.004 then
    update public.contas_avulsas
       set status = 'baixada', pago_em = p_pago_em, pago_por = v_uid,
           conta_bancaria_baixa_id = p_conta_bancaria_id
     where id = p_conta_avulsa_id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke all on function public.baixar_conta_avulsa(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb) from public, anon;
grant execute on function public.baixar_conta_avulsa(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb) to authenticated;
