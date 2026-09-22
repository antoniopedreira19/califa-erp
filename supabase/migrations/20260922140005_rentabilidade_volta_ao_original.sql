-- =============================================================================
-- vw_job_rentabilidade volta à definição de antes (decisão 099)
-- =============================================================================
--
-- 20260922140002 trocou, dentro de vw_job_rentabilidade, a leitura de
-- jobs_itens_orcado pela linha "como o financeiro vê"
-- (vw_itens_orcado_financeiro). A view é da frente do Antonio (migrations
-- 20260829100001 e 20260829110001, relatórios) e a regra é não mexer no que
-- é dele: a troca sai aqui, e a decisão fica com o Tiago e o Antonio.
--
-- Efeito de deixar como estava: enquanto uma errata de save de job aberto
-- aguarda aprovação, o relatório de rentabilidade já tira aquela linha do
-- imposto previsto e do custo realizado (a produção vê o pedido na hora),
-- enquanto o faturamento previsto do mesmo relatório segue o número antigo
-- até a decisão.
-- =============================================================================

do $$
declare
  v_def text;
  v_qtd integer;
begin
  v_def := rtrim(btrim(pg_get_viewdef('public.vw_job_rentabilidade'::regclass)), ';');

  select count(*) into v_qtd
    from regexp_matches(v_def, '\mvw_itens_orcado_financeiro jio\M', 'g');
  if v_qtd <> 2 then
    raise exception 'vw_job_rentabilidade: esperava 2 leituras de vw_itens_orcado_financeiro, achei %.', v_qtd;
  end if;

  v_def := regexp_replace(v_def, '\mvw_itens_orcado_financeiro jio\M', 'jobs_itens_orcado jio', 'g');
  execute 'create or replace view public.vw_job_rentabilidade with (security_invoker = true) as ' || v_def;
end;
$$;
