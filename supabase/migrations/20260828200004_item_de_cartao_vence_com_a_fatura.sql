-- =====================================================================
-- Item de cartão vence junto com a fatura dele
--
-- A compra no cartão não tem data de pagamento própria: ela sai quando a
-- fatura sai. Até aqui a data vinha calculada no cliente, na hora de
-- criar a avulsa, e depois nunca mais era revista.
--
-- Isso ficava errado assim que a compra rolava de fatura — o que passou a
-- acontecer em 28/08/2026, quando a compra deixou de entrar em fatura já
-- fechada e passou a cair na competência seguinte. A avulsa continuava
-- dizendo "vence 05/10" enquanto a fatura dela vencia 05/12, e a coluna
-- Vencimento da aba Cartão mostrava a data velha.
--
-- Agora quem dita a data é a fatura, no mesmo gatilho que escolhe a
-- fatura. As três datas andam juntas porque a avulsa nasce com as três
-- iguais; `data_pagamento_primeira` só é tocada no INSERT, porque no
-- UPDATE ela é congelada por `trg_congela_primeira_data`.
--
-- Não há caso em que isso atropele uma escolha de quem usa: item de
-- cartão não tem data repactuável — repactuar é assunto da fatura.
-- =====================================================================

create or replace function public.avulsa_entra_na_fatura()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vencimento date;
begin
  if new.forma_pagamento is distinct from 'cartao_credito'
     or new.cartao_credito_id is null then
    new.fatura_cartao_id := null;
    return new;
  end if;

  new.fatura_cartao_id := public.fatura_aberta_do_cartao(
    new.cartao_credito_id,
    coalesce(new.data_prevista_pagamento, new.data_pagamento, current_date)
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
