-- =====================================================================
-- A compra escolhe a fatura pela data da COMPRA, não pela data de
-- pagamento dela
--
-- O bug, em ordem: (1) a tela, ao escolher o cartão, preenchia "Data
-- prevista de pagamento" com o VENCIMENTO da próxima fatura — 05/10 para
-- uma compra de 28/08; (2) o gatilho lia esse mesmo campo como se fosse a
-- data da compra e calculava a fatura de novo, a partir de 05/10; (3)
-- resultado: a compra de 28/08 caía na fatura que fecha em 25/10 e vence
-- em 05/11, uma competência inteira atrasada.
--
-- Duas voltas do mesmo cálculo, uma alimentando a outra. Pego no teste de
-- 28/08/2026 — a FC-00001 nasceu com competência 25/10 quando devia ser
-- 25/09.
--
-- A regra: quem escolhe a fatura é a data da compra. No INSERT isso é
-- `current_date`, o dia em que a compra está sendo lançada. A data de
-- pagamento da avulsa passa a ser CONSEQUÊNCIA — o vencimento da fatura
-- em que ela caiu — e não mais entrada do cálculo.
--
-- No UPDATE a fatura não é recalculada enquanto ela continuar aberta e o
-- cartão for o mesmo: mexer em outro campo da avulsa não pode fazer ela
-- pular de fatura. Se a fatura fechou (ou o cartão mudou), aí sim ela
-- procura de novo — e o `fatura_aberta_do_cartao` rola para a competência
-- seguinte.
--
-- ⚠️ Fica em aberto: não existe campo "data da compra". Enquanto não
-- existir, uma compra lançada com atraso entra na fatura aberta do dia em
-- que foi lançada, não na do dia em que foi feita. Combinar com o Tiago
-- se o financeiro precisa lançar compra retroativa.
-- =====================================================================

create or replace function public.avulsa_entra_na_fatura()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vencimento date;
  v_status     fatura_cartao_status;
begin
  if new.forma_pagamento is distinct from 'cartao_credito'
     or new.cartao_credito_id is null then
    new.fatura_cartao_id := null;
    return new;
  end if;

  -- No UPDATE, a fatura só é reescolhida se a que estava lá não serve
  -- mais: fechou, sumiu, ou o cartão mudou.
  if tg_op = 'UPDATE' and new.fatura_cartao_id is not null then
    select status into v_status
      from faturas_cartao
     where id = new.fatura_cartao_id
       and cartao_credito_id = new.cartao_credito_id;

    if found and v_status = 'aberta' then
      return new;
    end if;
  end if;

  -- Data da COMPRA, não a de pagamento: a de pagamento sai daqui, e usá-la
  -- como entrada empurrava a compra uma competência para a frente.
  new.fatura_cartao_id := public.fatura_aberta_do_cartao(
    new.cartao_credito_id,
    current_date
  );

  select data_vencimento into v_vencimento
    from faturas_cartao where id = new.fatura_cartao_id;

  if v_vencimento is not null then
    new.data_prevista_pagamento := v_vencimento;
    new.data_pagamento := v_vencimento;
    if tg_op = 'INSERT' then
      new.data_pagamento_primeira := v_vencimento;
    end if;
  end if;

  return new;
end;
$function$;
