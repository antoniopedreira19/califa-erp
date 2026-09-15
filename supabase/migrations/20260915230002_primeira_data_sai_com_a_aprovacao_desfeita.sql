-- ===========================================================================
-- A primeira data de pagamento sai junto com a aprovação desfeita
-- ===========================================================================
-- Decisão 083, complemento da 20260915230001 (mesmo dia).
--
-- `trg_congela_primeira_data` guarda a PRIMEIRA data de pagamento da parcela
-- contra repactuação: uma vez gravada, nenhum update a muda. Isso está certo
-- enquanto a aprovação existe — é o histórico que o pop-up de edição mostra
-- ao lado do vencimento original.
--
-- Só que a reprovação da PP aprovada (083, 4a) desfaz a aprovação INTEIRA, e
-- a trigger devolvia a primeira data em silêncio: a PP voltava para a
-- produção carregando a data de uma aprovação que não existe mais, e a
-- aprovação seguinte a preservaria pelo `coalesce` de `aprovar_pp_com_data`.
--
-- A trava passa a ter uma exceção estreita: quando a linha fica SEM data de
-- pagamento E sem primeira data no mesmo update, é a aprovação saindo, e o
-- histórico dela sai junto. Repactuação nunca cai nesse caso — ela só mexe em
-- `data_pagamento`, que continua preenchida.
--
-- O vencimento negociado com o fornecedor (`data_vencimento`) não é tocado
-- aqui nem lá: ele é o que a produção combinou e o que o PDF mostra.

create or replace function public.congela_data_pagamento_primeira()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.data_pagamento_primeira is not null
     and not (new.data_pagamento is null and new.data_pagamento_primeira is null)
  then
    new.data_pagamento_primeira := old.data_pagamento_primeira;
  end if;
  return new;
end;
$$;

comment on column public.pedidos_compra_parcelas.data_pagamento_primeira is
  'A PRIMEIRA data de pagamento já definida para esta parcela. Gravada junto com data_pagamento na aprovação e congelada por trigger — repactuar não a altera. Sai apenas quando a aprovação é desfeita pela reprovação da PP (decisão 083), que zera as duas datas de uma vez. É o histórico mínimo que o pop-up de edição exibe ao lado do vencimento original.';
