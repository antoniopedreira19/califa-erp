-- Racional: função SQL espelho do helper TS lib/cartoes/proxima-fatura.ts.
-- Usada pela RPC gerar_ocorrencias_recorrentes (patch na próxima migration
-- desta feature) para calcular a data de vencimento da fatura na
-- materialização de uma recorrência de cartão. Regra idêntica ao helper
-- TS: se hoje <= dia, retorna dia deste mês; senão dia do mês seguinte;
-- dia > último dia do mês cai no último dia. Ver spec seção 4.3.

create or replace function proxima_fatura_cartao(
  p_cartao_id uuid,
  p_referencia date default current_date
) returns date
language plpgsql
stable
as $$
declare
  v_dia smallint;
  v_ano int;
  v_mes int;
  v_dia_referencia int;
  v_ano_alvo int;
  v_mes_alvo int;
  v_ultimo_dia_alvo int;
  v_dia_alvo int;
begin
  select dia_vencimento_fatura into v_dia
  from cartoes_credito where id = p_cartao_id;

  if v_dia is null then
    raise exception 'cartao_credito não encontrado: %', p_cartao_id;
  end if;

  v_ano := extract(year from p_referencia);
  v_mes := extract(month from p_referencia);
  v_dia_referencia := extract(day from p_referencia);

  if v_dia_referencia <= v_dia then
    v_ano_alvo := v_ano;
    v_mes_alvo := v_mes;
  else
    v_ano_alvo := case when v_mes = 12 then v_ano + 1 else v_ano end;
    v_mes_alvo := case when v_mes = 12 then 1 else v_mes + 1 end;
  end if;

  v_ultimo_dia_alvo := extract(day from
    (date_trunc('month', make_date(v_ano_alvo, v_mes_alvo, 1))
     + interval '1 month - 1 day')::date);

  v_dia_alvo := least(v_dia::int, v_ultimo_dia_alvo);
  return make_date(v_ano_alvo, v_mes_alvo, v_dia_alvo);
end;
$$;

grant execute on function proxima_fatura_cartao(uuid, date) to authenticated;
