-- =====================================================================
-- A remessa CNAB paga o líquido da PP com retenção
-- (decisão 145, item 1 — Tiago, 04/10/2026: "Resolva 1")
-- =====================================================================
--
-- Até aqui a remessa levava o que faltava pagar da parcela, sem descontar
-- a retenção que o financeiro decidiu na aprovação da PP, e a baixa do
-- documento que foi para uma remessa só aceitava o valor cheio, sem
-- retenção (interino da D15, decisão 125). Ninguém retinha o imposto do
-- fornecedor: quem paga sem reter responde pelo imposto, com multa de 75%
-- sobre o que deixou de reter (Lei 10.426/2002, art. 9º).
--
-- Agora a remessa desconta a retenção da aprovação, pela mesma conta da
-- baixa (`retencoesPelaAprovacao`: cada imposto arredondado em centavos
-- sobre o que falta), e paga o líquido. O item guarda o que reteve:
--   - `retido`: a soma retida; 0 = pagou o valor cheio, como antes;
--   - `retencoes`: [{imposto, aliquota, valor}], para a baixa repetir.
--
-- A baixa da parcela que está numa remessa ativa (não cancelada):
--   - é sempre do que falta (o banco pagou o documento inteiro);
--   - remessa que pagou o valor cheio (retido = 0): sem retenção, como antes;
--   - remessa que pagou o líquido (retido > 0): o líquido da baixa
--     (valor − retidos) tem de ser o valor que o banco pagou.
--
-- Aditiva: duas colunas com default, uma função auxiliar nova e o corpo da
-- `baixar_parcela_pp` trocado só no bloco da remessa (mesma assinatura,
-- mesmos grants). A conta avulsa não tem retenção da aprovação: a remessa
-- dela continua pagando o valor cheio, e `baixar_conta_avulsa` não muda.
-- =====================================================================

alter table public.cnab_remessas_itens
  add column if not exists retido numeric(14,2) not null default 0,
  add column if not exists retencoes jsonb not null default '[]'::jsonb;

alter table public.cnab_remessas_itens
  drop constraint if exists chk_cnab_item_retido;
alter table public.cnab_remessas_itens
  add constraint chk_cnab_item_retido check (retido >= 0);

comment on column public.cnab_remessas_itens.retido is
  'Soma retida na fonte que a remessa descontou do pagamento (decisão 145). 0 = pagou o valor cheio. O item paga `valor`, o líquido.';
comment on column public.cnab_remessas_itens.retencoes is
  'As retenções descontadas, [{imposto, aliquota, valor}]: as da aprovação da PP sobre o que faltava pagar (decisão 145).';

-- O item da remessa ativa (não cancelada) de um documento; o mais recente.
create or replace function public._item_da_remessa(p_documento_id uuid)
returns table (valor numeric, retido numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.valor, i.retido
    from public.cnab_remessas_itens i
    join public.cnab_remessas r on r.id = i.remessa_id
   where i.origem_id = p_documento_id
     and r.status <> 'cancelado'
   order by i.created_at desc
   limit 1;
$function$;

revoke all on function public._item_da_remessa(uuid) from public, anon, authenticated;

comment on function public._item_da_remessa(uuid) is
  'O valor pago e o retido do item da remessa ativa de um documento (decisão 145). Sem linha: o documento não está em remessa.';

CREATE OR REPLACE FUNCTION public.baixar_parcela_pp(p_parcela_id uuid, p_pago_em date, p_conta_bancaria_id uuid, p_tipo_id uuid, p_subtipo_id uuid, p_forma_pagamento forma_pagamento DEFAULT NULL::forma_pagamento, p_cartao_credito_id uuid DEFAULT NULL::uuid, p_valor_baixa numeric DEFAULT NULL::numeric, p_retencoes jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid            uuid;
  v_parcela        pedidos_compra_parcelas%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_baixado        numeric;
  v_aberto         numeric;
  v_valor          numeric;
  v_retido         numeric;
  v_lancamento_id  uuid;
  v_descricao      text;
  v_res            record;
  v_remessa        record;
begin
  if p_pago_em is null then
    raise exception 'Informe a data do pagamento.';
  end if;
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;

  select * into v_parcela from public.pedidos_compra_parcelas where id = p_parcela_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  v_uid := public._exige_financeiro_para_baixar(v_parcela.tenant_id);

  if v_parcela.fatura_cartao_id is not null then
    raise exception 'Parcela paga no cartão não se baixa sozinha: ela espera na aba Cartão e sai na baixa da fatura inteira.';
  end if;
  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_parcela.pedido_compra_id;
  if v_pp.status <> 'aprovada' then
    raise exception 'A PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_baixado := public._bruto_baixado('pp_baixa', p_parcela_id);
  v_aberto := v_parcela.valor - v_baixado;
  if v_aberto <= 0.004 then
    raise exception 'Esta parcela já está quitada.';
  end if;
  v_valor := public._valor_da_baixa(p_valor_baixa, v_aberto);
  v_retido := public._retencoes_total(p_retencoes, v_valor);

  if v_valor < v_aberto - 0.004 or v_retido > 0 then
    if v_pp.verba_producao then
      raise exception 'PP de verba só aceita a baixa do valor inteiro, sem retenção.';
    end if;
    if p_forma_pagamento = 'cartao_credito' then
      raise exception 'No cartão, a baixa é sempre do valor inteiro: o item entra inteiro na fatura.';
    end if;
  end if;

  -- Parcela numa remessa ativa (decisão 145): o banco pagou o documento
  -- inteiro, pelo valor do item. A baixa é do que falta, e o líquido dela é
  -- o que o banco pagou — sem retenção, se a remessa pagou o valor cheio.
  select * into v_remessa from public._item_da_remessa(p_parcela_id);
  if found then
    if v_valor < v_aberto - 0.004 then
      raise exception 'Pago pela remessa: esta parcela só aceita a baixa do que falta.';
    end if;
    if v_remessa.retido <= 0 and v_retido > 0 then
      raise exception 'Pago pela remessa com o valor cheio: esta parcela só aceita a baixa do que falta, sem retenção.';
    end if;
    if v_remessa.retido > 0 and abs((v_valor - v_retido) - v_remessa.valor) >= 0.005 then
      raise exception 'A remessa pagou R$ % ao fornecedor (o que faltava menos a retenção da aprovação da PP): o líquido da baixa precisa ser esse valor.',
        translate(to_char(v_remessa.valor, 'FM999,999,990.00'), ',.', '.,');
    end if;
  end if;

  select count(*)::int into v_total from public.pedidos_compra_parcelas where pedido_compra_id = v_pp.id;

  if p_forma_pagamento = 'cartao_credito' then
    if v_baixado > 0 then
      raise exception 'Esta parcela já tem baixa parcial: o restante não vai para o cartão.';
    end if;

    v_descricao := 'Cartão · PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_pp.servico, 1, 140);

    select * into v_res from public.cartao_lancar_item(
      v_pp.tenant_id, v_pp.empresa_id, p_cartao_credito_id, p_pago_em,
      v_parcela.valor, 'saida', v_descricao,
      p_tipo_id, p_subtipo_id,
      v_pp.fornecedor_id, null, v_pp.job_id,
      null, v_pp.id, v_parcela.id, null, null,
      'pp_baixa', 'item', v_uid, null
    );
    v_lancamento_id := v_res.lancamento_id;

    update public.pedidos_compra_parcelas
       set pago_em = p_pago_em, pago_por = v_uid,
           fatura_cartao_id = v_res.fatura_id
     where id = p_parcela_id;
  else
    v_conta := public._conta_da_baixa(p_conta_bancaria_id, v_parcela.tenant_id, p_pago_em, 'pagamento');

    v_descricao := 'PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_pp.servico, 1, 140);

    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
      forma_pagamento, cartao_credito_id,
      origem, criado_por
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_valor - v_retido,
      'saida', v_descricao, p_tipo_id, p_subtipo_id,
      v_pp.fornecedor_id, v_pp.job_id, v_pp.id, v_parcela.id,
      p_forma_pagamento, null,
      'pp_baixa', v_uid
    )
    returning id into v_lancamento_id;

    perform public._retencoes_gravar(v_lancamento_id, v_parcela.tenant_id, p_retencoes, v_uid);

    if v_baixado + v_valor >= v_parcela.valor - 0.004 then
      update public.pedidos_compra_parcelas
         set pago_em = p_pago_em, pago_por = v_uid
       where id = p_parcela_id;
    end if;
  end if;

  select count(*)::int into v_em_aberto
    from public.pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id and pago_em is null;

  if v_em_aberto = 0 then
    update public.pedidos_compra
       set status = 'pago', pago_em = p_pago_em, pago_por = v_uid
     where id = v_pp.id;
  end if;

  return v_lancamento_id;
end;
$function$;
