-- =====================================================================
-- Views projetam só o que falta do documento com baixa parcial
-- (decisão 125, Tiago, 29/09/2026)
-- =====================================================================
--
-- Com a baixa parcial (20260929800001), o documento em aberto pode já ter
-- baixas. `vw_a_pagar` e `vw_fluxo_caixa` projetavam o valor cheio de
-- todo documento em aberto: a baixa parcial entraria duas vezes, uma
-- como movimento (o lançamento) e outra dentro do previsto.
--
-- O que falta = valor − soma das baixas pelo valor a dar baixa (líquido +
-- retidos). O retido não volta para o previsto: no receber, é dinheiro
-- que o cliente não vai mandar; no pagar, a guia fica para o módulo
-- fiscal (P6).
--
-- - `vw_a_pagar`: a parcela de PP e a avulsa em aberto levam o que falta.
-- - `vw_fluxo_caixa`: o previsto do título (parte própria e parte em
--   save), da parcela de PP e da avulsa/recorrência leva o que falta. O
--   título escala pela fração em aberto (as duas partes, na proporção).
--   `vw_fluxo_caixa_job_totais` lê dela e acompanha sem mudança.
--
-- As duas views são editadas pela definição publicada, com cada trecho
-- trocado conferido para existir UMA vez — o mesmo padrão das migrations
-- 20260922140002 e 20260920100003. As subconsultas leem as tabelas pelo
-- dono da view, como o resto delas (nenhuma das duas é security_invoker).
--
-- Duas views novas, security_invoker, para as telas:
-- - `vw_baixado_por_documento`: quanto cada documento já tem de baixa
--   (líquido, retido, baixado e quantas baixas).
-- - `vw_retencao_mais_recente`: as alíquotas da última baixa com retenção
--   de cada cliente ou fornecedor, para o "Repetir as alíquotas" (D6 2a).
-- =====================================================================

do $$
declare
  v_def   text;
  v_qtd   integer;
  v_b_pp  text := 'COALESCE((SELECT sum(lb.valor + COALESCE((SELECT sum(rb.valor) FROM public.baixas_retencoes rb WHERE rb.lancamento_id = lb.id), (0)::numeric)) FROM public.lancamentos_financeiros lb WHERE lb.origem = ''pp_baixa''::public.origem_lancamento AND lb.pedido_compra_parcela_id = par.id), (0)::numeric)';
  v_b_av  text := 'COALESCE((SELECT sum(lb.valor + COALESCE((SELECT sum(rb.valor) FROM public.baixas_retencoes rb WHERE rb.lancamento_id = lb.id), (0)::numeric)) FROM public.lancamentos_financeiros lb WHERE lb.origem = ''avulsa_baixa''::public.origem_lancamento AND lb.conta_avulsa_id = a.id), (0)::numeric)';
  v_b_t   text := 'COALESCE((SELECT sum(lb.valor + COALESCE((SELECT sum(rb.valor) FROM public.baixas_retencoes rb WHERE rb.lancamento_id = lb.id), (0)::numeric)) FROM public.lancamentos_financeiros lb WHERE lb.origem = ''titulo_baixa''::public.origem_lancamento AND lb.titulo_receber_id = t.id), (0)::numeric)';
  v_f_t   text;
  v_de    text;
begin
  v_f_t := '((1)::numeric - (' || v_b_t || ' / NULLIF(t.valor, (0)::numeric)))';

  -- -------------------------------------------------------------------
  -- vw_a_pagar
  -- -------------------------------------------------------------------
  v_def := rtrim(btrim(pg_get_viewdef('public.vw_a_pagar'::regclass)), ';');

  v_de := '(par.valor)::numeric(14,2) AS valor';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'vw_a_pagar: esperava 1 valor da parcela de PP, achei %.', v_qtd;
  end if;
  v_def := replace(v_def, v_de, '((par.valor - ' || v_b_pp || '))::numeric(14,2) AS valor');

  select count(*) into v_qtd from regexp_matches(v_def, '\ma\.valor,(\s+)a\.natureza,', 'g');
  if v_qtd <> 1 then
    raise exception 'vw_a_pagar: esperava 1 valor da avulsa, achei %.', v_qtd;
  end if;
  v_def := regexp_replace(
    v_def, '\ma\.valor,(\s+)a\.natureza,',
    '((a.valor - ' || v_b_av || '))::numeric(14,2) AS valor,\1a.natureza,'
  );

  execute 'create or replace view public.vw_a_pagar as ' || v_def;

  -- -------------------------------------------------------------------
  -- vw_fluxo_caixa
  -- -------------------------------------------------------------------
  v_def := rtrim(btrim(pg_get_viewdef('public.vw_fluxo_caixa'::regclass)), ';');

  -- Título: parte própria.
  v_de := '(((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)) * COALESCE(fr.fator, 1.0)))::numeric(14,2) AS valor';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 previsto de título (parte própria), achei %.', v_qtd;
  end if;
  v_def := replace(v_def, v_de,
    '((((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)) * COALESCE(fr.fator, 1.0)) * '
    || v_f_t || '))::numeric(14,2) AS valor');

  -- Título: parte em save.
  v_de := '((t.valor - tp.valor_proprio))::numeric(14,2) AS "numeric"';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 previsto de título (parte em save), achei %.', v_qtd;
  end if;
  v_def := replace(v_def, v_de,
    '(((t.valor - tp.valor_proprio) * ' || v_f_t || '))::numeric(14,2) AS "numeric"');

  -- Parcela de PP.
  v_de := '(par.valor)::numeric(14,2) AS valor';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 previsto de parcela de PP, achei %.', v_qtd;
  end if;
  v_def := replace(v_def, v_de, '((par.valor - ' || v_b_pp || '))::numeric(14,2) AS valor');

  -- Avulsa e recorrência.
  v_de := '((a.valor * ar.fator))::numeric(14,2) AS valor';
  v_qtd := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  if v_qtd <> 1 then
    raise exception 'vw_fluxo_caixa: esperava 1 previsto de avulsa, achei %.', v_qtd;
  end if;
  v_def := replace(v_def, v_de, '(((a.valor - ' || v_b_av || ') * ar.fator))::numeric(14,2) AS valor');

  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;
end;
$$;

-- ---------------------------------------------------------------------
-- Quanto cada documento já tem de baixa
-- ---------------------------------------------------------------------

create or replace view public.vw_baixado_por_documento
with (security_invoker = on) as
select l.tenant_id,
       case l.origem
         when 'titulo_baixa' then 'titulo_receber'
         when 'pp_baixa' then 'pp_parcela'
         else 'conta_avulsa'
       end as documento_tipo,
       case l.origem
         when 'titulo_baixa' then l.titulo_receber_id
         when 'pp_baixa' then l.pedido_compra_parcela_id
         else l.conta_avulsa_id
       end as documento_id,
       count(*)::integer as qtd_baixas,
       sum(l.valor)::numeric(14,2) as liquido,
       coalesce(sum(r.retido), 0)::numeric(14,2) as retido,
       (sum(l.valor) + coalesce(sum(r.retido), 0))::numeric(14,2) as baixado
  from public.lancamentos_financeiros l
  left join (
    select rb.lancamento_id, sum(rb.valor) as retido
      from public.baixas_retencoes rb
     group by rb.lancamento_id
  ) r on r.lancamento_id = l.id
 where l.origem in ('titulo_baixa', 'pp_baixa', 'avulsa_baixa')
   and (l.origem <> 'pp_baixa' or l.pedido_compra_parcela_id is not null)
 group by 1, 2, 3;

comment on view public.vw_baixado_por_documento is
  'Baixas vivas por documento (decisão 125): líquido, retido e baixado (= líquido + retido). O que falta = valor do documento − baixado.';

revoke all on table public.vw_baixado_por_documento from public, anon;
grant select on table public.vw_baixado_por_documento to authenticated;

-- ---------------------------------------------------------------------
-- As alíquotas da última retenção de cada cliente ou fornecedor
-- ---------------------------------------------------------------------

create or replace view public.vw_retencao_mais_recente
with (security_invoker = on) as
select distinct on (b.tenant_id, b.natureza, b.parte_id)
       b.tenant_id,
       b.natureza,
       b.parte_id,
       b.lancamento_id,
       b.referencia,
       b.data_movimento,
       b.aliquotas
  from (
    select l.tenant_id,
           l.natureza,
           coalesce(l.cliente_id, l.fornecedor_id) as parte_id,
           l.id as lancamento_id,
           l.data_movimento,
           l.created_at,
           coalesce('NF ' || f.numero_nf, pp.codigo, a.codigo) as referencia,
           (select jsonb_object_agg(r.imposto, r.aliquota)
              from public.baixas_retencoes r
             where r.lancamento_id = l.id and r.aliquota is not null) as aliquotas
      from public.lancamentos_financeiros l
      left join public.titulos_receber t on t.id = l.titulo_receber_id
      left join public.faturamentos f on f.id = t.faturamento_id
      left join public.pedidos_compra pp on pp.id = l.pedido_compra_id
      left join public.contas_avulsas a on a.id = l.conta_avulsa_id
     where l.origem in ('titulo_baixa', 'pp_baixa', 'avulsa_baixa')
       and exists (
         select 1 from public.baixas_retencoes r
          where r.lancamento_id = l.id and r.aliquota is not null
       )
  ) b
 where b.parte_id is not null
 order by b.tenant_id, b.natureza, b.parte_id, b.data_movimento desc, b.created_at desc;

comment on view public.vw_retencao_mais_recente is
  'Alíquotas da última baixa com retenção por cliente/fornecedor e natureza, para o "Repetir as alíquotas" da baixa (decisão 125, D6 2a).';

revoke all on table public.vw_retencao_mais_recente from public, anon;
grant select on table public.vw_retencao_mais_recente to authenticated;
