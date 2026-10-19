-- O estorno de baixa é lançado no dia de Brasília, não no de UTC.
--
-- O banco roda em UTC (`TimeZone = UTC`): `current_date` é o dia de
-- Greenwich. Das 21h à meia-noite de Brasília ele já é o dia seguinte, e
-- um estorno feito nessa faixa era gravado em `lancamentos_financeiros`
-- com `data_movimento` de amanhã — caía no extrato do dia seguinte e não
-- batia com o do banco na conciliação. Em 19/10/2026 havia 1 estorno no
-- banco, feito de dia.
--
-- 1. `public.hoje_em_sao_paulo()`: o dia de hoje em Brasília. É o par, no
--    banco, do `hojeEmSaoPauloIso()` de `lib/calculos/janelas-pagamento.ts`.
-- 2. As 7 funções que lançam estorno trocam o seu único `current_date` por
--    ela. A troca é feita sobre a definição que está no ar
--    (`pg_get_functiondef`), não sobre uma cópia escrita à mão: o resto de
--    cada função fica byte a byte igual. Se alguma tiver um número de
--    `current_date` diferente de 1, a migration para sem trocar nada.
--    `create or replace` mantém dono, `security definer` e GRANTs.
--
-- Ficam em UTC, de propósito, os outros `current_date` do banco: a
-- `vw_fluxo_caixa` (o fluxo do job no código acompanha o "hoje" dela), as
-- rotinas agendadas das 06:00 UTC (03:00 em Brasília, mesmo dia nos dois
-- fusos) e o resto, que fica para outra entrega.
--
-- Mudança no comportamento de funções existentes (algumas da outra frente,
-- como o estorno do cartão), autorizada pelo Tiago em 19/10/2026.

create or replace function public.hoje_em_sao_paulo()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

comment on function public.hoje_em_sao_paulo() is
  'Hoje em Brasília. O banco roda em UTC, e current_date depois das 21h já é o dia seguinte. Par do hojeEmSaoPauloIso() do código.';

revoke all on function public.hoje_em_sao_paulo() from public, anon;
grant execute on function public.hoje_em_sao_paulo() to authenticated;

do $$
declare
  v_nome text;
  v_oid  oid;
  v_def  text;
  v_n    int;
begin
  foreach v_nome in array array[
    'avulsa_estorno_lanca_no_cartao',
    'estornar_baixa_avulsa',
    'estornar_baixa_desembolso_parcela',
    'estornar_baixa_devolucao_verba',
    'estornar_baixa_fatura_cartao',
    'estornar_baixa_pp_parcela',
    'estornar_baixa_titulo'
  ] loop
    select p.oid into strict v_oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nome;

    v_def := pg_get_functiondef(v_oid);
    select count(*) into v_n from regexp_matches(v_def, '\mcurrent_date\M', 'gi');

    if v_n = 0 and position('hoje_em_sao_paulo' in v_def) > 0 then
      continue; -- já trocada
    elsif v_n <> 1 then
      raise exception 'public.%: esperava 1 current_date, achou %', v_nome, v_n;
    end if;

    execute regexp_replace(v_def, '\mcurrent_date\M', 'public.hoje_em_sao_paulo()', 'gi');
  end loop;
end
$$;
