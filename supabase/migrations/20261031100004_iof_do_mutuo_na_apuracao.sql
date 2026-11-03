-- =====================================================================
-- Apuração do IOF do mútuo (decisão 230, segunda etapa — Tiago, 31/10/2026)
-- =====================================================================
--
-- Só o IOF do mútuo tem guia nossa: quem concede o crédito recolhe (Decreto
-- 6.306/2007, art. 5º, III). Câmbio, cartão e crédito de banco são cobrados
-- pelo banco e não entram na Apuração.
--
-- O tributo novo entra nos dois CHECKs. Na baixa, o centro depende do CNPJ que
-- pagou, como a planilha: California junto do mútuo (12 · 998), GoCrazy em
-- Custo Tributário (03 · 007). O corpo de `baixar_imposto` vem do banco para
-- não ser redigitado aqui.
-- =====================================================================

alter table public.fiscal_aprovacoes drop constraint if exists fiscal_aprovacoes_tributo_check;
alter table public.fiscal_aprovacoes
  add constraint fiscal_aprovacoes_tributo_check
  check (tributo in ('ISS', 'PIS', 'COFINS', 'IRPJ', 'CSLL', 'ISS_RET', 'CSRF', 'IRRF', 'IOF'));

alter table public.impostos_a_pagar drop constraint if exists impostos_a_pagar_tributo_check;
alter table public.impostos_a_pagar
  add constraint impostos_a_pagar_tributo_check
  check (tributo in ('ISS', 'PIS', 'COFINS', 'IRPJ', 'CSLL', 'ISS_RET', 'CSRF', 'IRRF', 'OUTRO', 'IOF'));

do $$
declare
  v_def  text;
  v_novo text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'baixar_imposto';
  v_novo := replace(
    v_def,
    $x$if v_imp.tributo in ('ISS_RET', 'CSRF', 'IRRF') then$x$,
    $x$if v_imp.tributo = 'IOF' then
    select case when ec.iof_do_mutuo_abaixo_do_lucro then '12' else '03' end,
           case when ec.iof_do_mutuo_abaixo_do_lucro then '998' else '007' end
      into v_cod_tipo, v_cod_subtipo
      from public.empresas_contabeis ec
     where ec.id = v_imp.empresa_contabil_id;
  elsif v_imp.tributo in ('ISS_RET', 'CSRF', 'IRRF') then$x$
  );
  if v_novo = v_def then raise exception 'baixar_imposto mudou: revise esta migration.'; end if;
  execute v_novo;
end;
$$;
