-- O cartão passa a ter dia de FECHAMENTO, além do vencimento.
--
-- `proxima_fatura_cartao` usava o vencimento como se fosse a fronteira da
-- fatura: compra até o dia do vencimento caía na fatura do mês, depois
-- disso na seguinte. Isso só acerta quando as duas datas coincidem.
--
-- No cartão comum — fecha dia 25, vence dia 5 — a conta erra: uma compra
-- do dia 28 é jogada na fatura que vence dia 5 do mês seguinte, quando ela
-- na verdade entra na fatura que fecha no dia 25 DAQUELE mês seguinte, e
-- portanto vence um mês depois. Uma fatura inteira de diferença.
--
-- Isso já afeta as recorrências, que chamam esta função para decidir a
-- data de pagamento de cada ocorrência.
--
-- Duas datas, dois papéis:
--   · FECHAMENTO decide em QUAL fatura a compra cai.
--   · VENCIMENTO decide QUANDO essa fatura é paga.
--
-- Anulável de propósito: enquanto ninguém preencher, a função cai no
-- comportamento antigo. Sem isso, um cartão cadastrado antes de hoje
-- passaria a receber `null` e a recorrência quebraria.

alter table public.cartoes_credito
  add column if not exists dia_fechamento_fatura smallint;

alter table public.cartoes_credito
  drop constraint if exists chk_cartao_dia_fechamento;
alter table public.cartoes_credito
  add constraint chk_cartao_dia_fechamento check (
    dia_fechamento_fatura is null
    or (dia_fechamento_fatura between 1 and 31)
  );

comment on column public.cartoes_credito.dia_fechamento_fatura is
  'Dia em que a fatura fecha — decide em QUAL fatura a compra cai. Diferente de dia_vencimento_fatura, que decide quando ela é paga. Nulo cai no comportamento anterior a 28/08/2026, que usava o vencimento como fronteira.';

-- ---------------------------------------------------------------------
-- A conta da próxima fatura
-- ---------------------------------------------------------------------

create or replace function public.proxima_fatura_cartao(
  p_cartao_id uuid,
  p_referencia date default current_date
)
returns date
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_venc        smallint;
  v_fecha       smallint;
  v_dia_ref     int;
  v_ano_alvo    int;
  v_mes_alvo    int;
  v_ultimo_dia  int;
begin
  select dia_vencimento_fatura, dia_fechamento_fatura
    into v_venc, v_fecha
    from public.cartoes_credito
   where id = p_cartao_id;

  if v_venc is null then
    raise exception 'cartao_credito não encontrado: %', p_cartao_id;
  end if;

  v_dia_ref  := extract(day   from p_referencia);
  v_ano_alvo := extract(year  from p_referencia);
  v_mes_alvo := extract(month from p_referencia);

  -- Cartão sem fechamento cadastrado: comportamento de antes de
  -- 28/08/2026, com o vencimento fazendo as vezes de fronteira.
  if v_fecha is null then
    if v_dia_ref > v_venc then
      v_mes_alvo := v_mes_alvo + 1;
    end if;
  else
    -- 1. Em qual fatura a compra cai: a que fecha neste mês, se ela ainda
    --    não fechou; a do mês seguinte, se já fechou.
    if v_dia_ref > v_fecha then
      v_mes_alvo := v_mes_alvo + 1;
    end if;

    -- 2. Quando essa fatura vence. Vencimento ANTES ou NO dia do
    --    fechamento cai no mês seguinte ao do fechamento — é o caso comum
    --    (fecha 25, vence 5). Vencimento depois do fechamento vence no
    --    próprio mês (fecha 25, vence 30).
    if v_venc <= v_fecha then
      v_mes_alvo := v_mes_alvo + 1;
    end if;
  end if;

  -- Normaliza o mês, que pode ter passado de 12 nos dois passos acima.
  v_ano_alvo := v_ano_alvo + ((v_mes_alvo - 1) / 12);
  v_mes_alvo := ((v_mes_alvo - 1) % 12) + 1;

  -- Vencimento dia 31 em mês de 30 cai no último dia.
  v_ultimo_dia := extract(day from
    (date_trunc('month', make_date(v_ano_alvo, v_mes_alvo, 1))
     + interval '1 month - 1 day')::date);

  return make_date(v_ano_alvo, v_mes_alvo, least(v_venc::int, v_ultimo_dia));
end;
$function$;

revoke execute on function public.proxima_fatura_cartao(uuid, date) from public;
grant execute on function public.proxima_fatura_cartao(uuid, date) to authenticated;
