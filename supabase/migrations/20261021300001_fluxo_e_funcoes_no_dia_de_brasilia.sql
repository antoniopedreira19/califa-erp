-- O fluxo de caixa e três funções passam a usar o dia de Brasília, não o de UTC.
--
-- O banco roda em UTC (`TimeZone = UTC`): das 21h à meia-noite de Brasília,
-- `current_date` já é o dia seguinte. A migration 20261019700001 criou
-- `public.hoje_em_sao_paulo()` e trocou os estornos; o que ficou de fora
-- naquele dia entra aqui (autorizado pelo Tiago em 21/10/2026):
--
-- 1. `vw_fluxo_caixa` (16 `current_date`): a rolagem da previsão vencida
--    (Cronograma de desembolsos, Previsão de recebimento, Faturamento
--    previsto, as mesmas nas fatias de save) e a Recorrência prevista
--    (rolagem e horizonte de 12 meses). À noite, a previsão vencida caía um
--    dia depois, e a que vence hoje já rolava. Muda junto do código: o
--    `hoje` do fluxo no código passa a ser o `hojeEmSaoPauloIso()`.
-- 2. `avulsa_entra_na_fatura`: a compra no cartão sem data da compra
--    escolhia a fatura pelo dia de amanhã.
-- 3. `conciliacao_resumo_contas`: o "Saldo atual" da conciliação já somava
--    o movimento datado de amanhã.
-- 4. `calcular_proxima_data_inicial` (da frente do Antonio): a recorrência
--    mensal do dia 22 criada às 22h de 21/10 começava em 22/11, e não em
--    22/10, e discordava do "Reativar", que já usa o dia de Brasília.
--
-- Como em 20261019700001, a troca é feita sobre a definição no ar
-- (`pg_get_functiondef`, `pg_get_viewdef`), não sobre uma cópia escrita à
-- mão: o resto fica igual, e a migration confere isso antes de terminar.
-- Se o número de `current_date` de algum objeto não for o esperado, ela
-- para sem trocar nada.
--
-- A troca é por `(select public.hoje_em_sao_paulo())`, não pela chamada
-- direta: com o `set search_path`, a função não é embutida no plano e custa
-- 5,4 µs por linha (1,16 s em 200 mil linhas, contra 73 ms do
-- `current_date`). Com o `select`, ela vira um InitPlan e roda uma vez por
-- consulta.
--
-- `create or replace` mantém dono, `security definer`, GRANTs, comentário e
-- a view dependente (`vw_fluxo_caixa_job_totais`). As rotinas agendadas das
-- 06:00 UTC (03:00 em Brasília) dão o mesmo dia nos dois fusos.

do $$
declare
  c_hoje constant text := '(select public.hoje_em_sao_paulo())';
  v_nome   text;
  v_oid    oid;
  v_def    text;
  v_novo   text;
  v_depois text;
  v_n      int;
begin
  -- Funções: 1 `current_date` em cada.
  foreach v_nome in array array[
    'avulsa_entra_na_fatura',
    'conciliacao_resumo_contas',
    'calcular_proxima_data_inicial'
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

    v_novo := regexp_replace(v_def, '\mcurrent_date\M', c_hoje, 'gi');
    execute v_novo;

    if pg_get_functiondef(v_oid) <> v_novo then
      raise exception 'public.%: a definição no ar não é a esperada', v_nome;
    end if;
  end loop;

  -- View: 16 `current_date`.
  v_def := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  select count(*) into v_n from regexp_matches(v_def, '\mcurrent_date\M', 'gi');

  if v_n = 0 and position('hoje_em_sao_paulo' in v_def) > 0 then
    return; -- já trocada
  elsif v_n <> 16 then
    raise exception 'public.vw_fluxo_caixa: esperava 16 current_date, achou %', v_n;
  end if;

  v_novo := regexp_replace(v_def, '\mcurrent_date\M', c_hoje, 'gi');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_novo;

  -- Conferência: devolvendo o CURRENT_DATE no lugar da subconsulta, a
  -- definição no ar é, byte a byte, a de antes.
  v_depois := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  if regexp_replace(
       v_depois,
       '\( SELECT (public\.)?hoje_em_sao_paulo\(\) AS hoje_em_sao_paulo\)',
       'CURRENT_DATE',
       'g'
     ) <> v_def then
    raise exception 'public.vw_fluxo_caixa: a definição no ar não é a esperada';
  end if;
end
$$;
