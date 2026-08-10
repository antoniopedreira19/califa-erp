-- =====================================================================
-- Task 013 — Funções auxiliares de cálculo de próxima data recorrência
-- Encapsulam a regra "último dia se >28" (clamping do dia_desejado ao
-- último dia do mês quando o mês não tem o dia pedido).
-- =====================================================================

-- 1) Helper: retorna make_date(ano, mes, LEAST(dia, último_dia_do_mes)).
create or replace function public.data_quinzena_do_mes(
  p_ano int, p_mes int, p_dia int
)
returns date
language sql
immutable
as $$
  select make_date(
    p_ano,
    p_mes,
    least(
      p_dia,
      extract(day from (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day'))::int
    )
  );
$$;

grant execute on function public.data_quinzena_do_mes(int, int, int) to authenticated;

-- 2) Próxima data para o cron: recebe template inteiro (linha da tabela)
--    e retorna a data seguinte, avançando conforme frequência.
create or replace function public.calcular_proxima_data_recorrencia(
  p_template contas_avulsas_recorrentes
)
returns date
language plpgsql
immutable
as $$
declare
  v_base date := p_template.proxima_data;
  v_prox date;
  v_ano int;
  v_mes int;
  v_datas date[];
begin
  case p_template.frequencia
    when 'mensal' then
      v_ano := extract(year from (v_base + interval '1 month'))::int;
      v_mes := extract(month from (v_base + interval '1 month'))::int;
      v_prox := public.data_quinzena_do_mes(v_ano, v_mes, p_template.dia_do_mes);

    when 'quinzenal' then
      -- Gera 4 candidatas (mês atual + próximo). Retorna a menor > v_base.
      v_datas := ARRAY[
        public.data_quinzena_do_mes(
          extract(year from v_base)::int,
          extract(month from v_base)::int,
          p_template.dia_quinzena_1),
        public.data_quinzena_do_mes(
          extract(year from v_base)::int,
          extract(month from v_base)::int,
          p_template.dia_quinzena_2),
        public.data_quinzena_do_mes(
          extract(year from (v_base + interval '1 month'))::int,
          extract(month from (v_base + interval '1 month'))::int,
          p_template.dia_quinzena_1),
        public.data_quinzena_do_mes(
          extract(year from (v_base + interval '1 month'))::int,
          extract(month from (v_base + interval '1 month'))::int,
          p_template.dia_quinzena_2)
      ];
      select min(d) into v_prox
        from unnest(v_datas) as d
       where d > v_base;

    when 'anual' then
      v_ano := (extract(year from v_base)::int) + 1;
      v_prox := public.data_quinzena_do_mes(v_ano, p_template.dia_do_ano_mes, p_template.dia_do_ano_dia);
  end case;

  return v_prox;
end;
$$;

grant execute on function public.calcular_proxima_data_recorrencia(contas_avulsas_recorrentes) to authenticated;

-- 3) Primeira data inicial ao criar template (ancorada em current_date).
create or replace function public.calcular_proxima_data_inicial(
  p_frequencia frequencia_recorrencia,
  p_dia_do_mes smallint,
  p_dia_quinzena_1 smallint,
  p_dia_quinzena_2 smallint,
  p_dia_do_ano_dia smallint,
  p_dia_do_ano_mes smallint
)
returns date
language plpgsql
stable
as $$
declare
  v_hoje date := current_date;
  v_ano int := extract(year from v_hoje)::int;
  v_mes int := extract(month from v_hoje)::int;
  v_prox date;
  v_datas date[];
begin
  case p_frequencia
    when 'mensal' then
      v_prox := public.data_quinzena_do_mes(v_ano, v_mes, p_dia_do_mes);
      if v_prox <= v_hoje then
        v_prox := public.data_quinzena_do_mes(
          extract(year from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          extract(month from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          p_dia_do_mes
        );
      end if;

    when 'quinzenal' then
      v_datas := ARRAY[
        public.data_quinzena_do_mes(v_ano, v_mes, p_dia_quinzena_1),
        public.data_quinzena_do_mes(v_ano, v_mes, p_dia_quinzena_2),
        public.data_quinzena_do_mes(
          extract(year from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          extract(month from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          p_dia_quinzena_1),
        public.data_quinzena_do_mes(
          extract(year from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          extract(month from (make_date(v_ano, v_mes, 1) + interval '1 month'))::int,
          p_dia_quinzena_2)
      ];
      select min(d) into v_prox from unnest(v_datas) as d where d > v_hoje;

    when 'anual' then
      v_prox := public.data_quinzena_do_mes(v_ano, p_dia_do_ano_mes, p_dia_do_ano_dia);
      if v_prox <= v_hoje then
        v_prox := public.data_quinzena_do_mes(v_ano + 1, p_dia_do_ano_mes, p_dia_do_ano_dia);
      end if;
  end case;

  return v_prox;
end;
$$;

grant execute on function public.calcular_proxima_data_inicial(
  frequencia_recorrencia, smallint, smallint, smallint, smallint, smallint
) to authenticated;
