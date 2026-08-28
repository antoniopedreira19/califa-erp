-- O item do cartão sabe de qual fatura ele é.
--
-- Fatia 3, passo 3 de 4. Até aqui o vínculo entre um item e a fatura era
-- por COINCIDÊNCIA de data: a avulsa no cartão nasce com
-- `data_pagamento` = vencimento da próxima fatura, e a fatura tem o mesmo
-- vencimento. Agrupar por isso funciona até alguém editar a data.
--
-- Com o vínculo explícito, a aba Cartão sabe exatamente o que está em cada
-- fatura, e o "redirecionar pagamento" — mover a compra que caiu no cartão
-- errado — vira um update de uma coluna, em vez de uma remarcação de datas
-- que pode não bater com fatura nenhuma.

alter table public.contas_avulsas
  add column if not exists fatura_cartao_id uuid
    references public.faturas_cartao (id) on delete set null;

create index if not exists idx_avulsas_fatura_cartao
  on public.contas_avulsas (fatura_cartao_id)
  where fatura_cartao_id is not null;

comment on column public.contas_avulsas.fatura_cartao_id is
  'Fatura do cartão em que este item entra. Só em avulsa com forma cartão. Explícito para o remanejamento não depender de coincidência de data (28/08/2026).';

-- ---------------------------------------------------------------------
-- O item entra na fatura ao nascer
-- ---------------------------------------------------------------------
-- Trigger, e não action: a avulsa no cartão nasce em três lugares — o
-- drawer, o "Lançar pagamento" da aba Cartão e a geração de ocorrência de
-- recorrência (que roda dentro do banco). Amarrar nos três, à mão, é onde
-- um deles ficaria para trás.
--
-- Vale para INSERT e para UPDATE que mexa em cartão ou data: trocar o
-- cartão de um item é justamente o "redirecionar pagamento".

create or replace function public.avulsa_entra_na_fatura()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.forma_pagamento is distinct from 'cartao_credito'
     or new.cartao_credito_id is null then
    new.fatura_cartao_id := null;
    return new;
  end if;

  -- A data que decide a fatura é a do PAGAMENTO previsto — que, no cartão,
  -- já vem calculada como o vencimento da fatura em que a compra cai.
  new.fatura_cartao_id := public.fatura_aberta_do_cartao(
    new.cartao_credito_id,
    coalesce(new.data_prevista_pagamento, new.data_pagamento, current_date)
  );

  return new;
end;
$function$;

drop trigger if exists trg_avulsa_entra_na_fatura on public.contas_avulsas;
create trigger trg_avulsa_entra_na_fatura
  before insert or update of cartao_credito_id, forma_pagamento, data_prevista_pagamento
  on public.contas_avulsas
  for each row
  execute function public.avulsa_entra_na_fatura();
