-- ===========================================================================
-- "Devolução verba" vira "Estorno de verba" nas views de títulos e de caixa
-- ===========================================================================
-- Decisão 081, pergunta 6a. Só o rótulo da descrição muda; colunas, natureza
-- (o estorno segue ENTRADA no caixa, pergunta 8a) e recorte são os mesmos.
--
-- As duas views são grandes (a de caixa tem 9 UNIONs e CTEs) e são lidas
-- por outras telas. Em vez de reescrevê-las à mão — onde uma vírgula errada
-- muda o fluxo de caixa de todo mundo —, o bloco pega a definição que está
-- no banco, troca a única ocorrência do rótulo e recria. Se o rótulo não
-- estiver lá exatamente uma vez, a migration para.
--
-- `create or replace view` mantém os GRANTs e a view dependente
-- (`vw_fluxo_caixa_job_totais`), porque as colunas não mudam.

do $$
declare
  v_view text;
  v_def  text;
  v_n    integer;
begin
  foreach v_view in array array['vw_a_pagar', 'vw_fluxo_caixa'] loop
    v_def := pg_get_viewdef(('public.' || v_view)::regclass);
    v_n := (length(v_def) - length(replace(v_def, '''Devolução verba ''::text', '')))
           / length('''Devolução verba ''::text');
    if v_n <> 1 then
      raise exception 'Esperava 1 ocorrência do rótulo em %, achei %.', v_view, v_n;
    end if;
    v_def := replace(v_def, '''Devolução verba ''::text', '''Estorno de verba ''::text');
    v_def := regexp_replace(v_def, ';\s*$', '');
    execute format('create or replace view public.%I as %s', v_view, v_def);
  end loop;
end $$;
