-- =============================================================================
-- Decisão 247 — A nota do save avulso não leva rateio de regional
-- =============================================================================
--
-- Desde a decisão 086 toda nota avulsa nasce com rateio de regional
-- (`exige_rateio_nota_avulsa`, gatilho de constraint adiado). O save avulso
-- é a exceção que o Tiago decidiu (protótipo aprovado em 09/11/2026): a
-- regional é a do job que consumir o crédito, então a nota nasce sem
-- rateio.
--
-- O gatilho é adiado (roda no fim da transação), e a nota e o save avulso
-- nascem na mesma transação (`emitir_faturamento_save_avulso`): quando ele
-- roda, a linha de `saves_avulsos` já existe e diz que esta nota é a
-- exceção. Qualquer outra nota avulsa continua precisando do rateio.
--
-- Fica para os relatórios por regional: a receita da nota de save avulso
-- não tem regional até o crédito ser consumido.
-- =============================================================================

create or replace function public.exige_rateio_nota_avulsa()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'faturamentos' then
    if new.origem_tipo is distinct from 'avulso' then
      return null;
    end if;
    v_id := new.id;
  else
    v_id := old.faturamento_id;
  end if;

  -- Decisão 247: a nota do save avulso fica na regional do job que consumir.
  if exists (select 1 from public.saves_avulsos s where s.faturamento_id = v_id) then
    return null;
  end if;

  if exists (
       select 1 from public.faturamentos f
        where f.id = v_id and f.origem_tipo = 'avulso'
     )
     and not exists (
       select 1 from public.faturamentos_regionais r
        where r.faturamento_id = v_id
     ) then
    raise exception 'Toda nota avulsa precisa de rateio de regional. Informe ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;
