-- =====================================================================
-- 20260920100002 — o lançamento do estorno de compra não duplica o prefixo
--
-- Racional: a tela que lança o estorno de compra (`estornarCompraCartao`)
-- já grava a avulsa como "Estorno · AV-00001 …", e o gatilho
-- `avulsa_estorno_lanca_no_cartao` (migration 20260920100001) prefixava
-- de novo ao criar o lançamento na conta-espelho — o extrato da fatura
-- mostrava "Estorno · Estorno · AV-00001 …". Apareceu na primeira leitura
-- da nova aba Cartão (decisão 093, entrega 2).
--
-- Só o prefixo muda; a regra é a mesma. O lançamento já gravado com o
-- prefixo duplicado (AV-00002, no projeto de teste) fica como está — a
-- tela da fatura colapsa a repetição na exibição.
--
-- Aditiva: `create or replace` da função do gatilho.
-- =====================================================================

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
  v_desc text;
begin
  if new.estorno_de_avulsa_id is null
     or new.forma_pagamento is distinct from 'cartao_credito'
     or new.cartao_credito_id is null
     or new.status = 'baixada' then
    return new;
  end if;

  v_data := coalesce(new.data_compra, current_date);
  v_quem := coalesce(auth.uid(), new.criado_por);

  -- A descrição da avulsa já costuma vir "Estorno · …" da tela; só
  -- prefixa quando não vem.
  v_desc := substring(new.descricao, 1, 180);
  if v_desc not ilike 'Estorno%' then
    v_desc := 'Estorno · ' || v_desc;
  end if;

  select * into v_res from public.cartao_lancar_item(
    new.tenant_id, new.empresa_id, new.cartao_credito_id, v_data,
    new.valor, new.natureza,
    v_desc,
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
