-- =============================================================================
-- Decisão 247 — A receita do save avulso migra para o job que consome
-- =============================================================================
--
-- Pedido do Tiago em 09/11/2026 ("Sim, como no save de job"): o job que
-- consome um save avulso recebe, nos relatórios, a receita que a nota do save
-- avulso cobrou por causa daquele consumo — a mesma regra do save de job
-- (decisões 028 §4 e 103):
--
--   receita migrada = consumo ÷ crédito do save avulso × valor da NF
--
-- O save avulso não tem job de origem: não há o que tirar de outro job.
--
--   * `vw_saves_consumos_financeiro` ganha a coluna `save_avulso_id` (no fim:
--     as de antes não mudam), nas duas partes (consumo gravado e pedido que
--     aguarda).
--   * `vw_job_rentabilidade` (decisão 103): o faturamento previsto e o
--     realizado do job que consome somam a receita migrada do save avulso.
--     No realizado ela vale inteira: a nota do save avulso já foi emitida.
--   * `vw_fluxo_caixa`: o dinheiro da nota do save avulso (os recebimentos e
--     os títulos em aberto) vira "saldo em save" do save avulso e vai para o
--     job que consome, na data em que entrou, na ordem do consumo — a mesma
--     máquina das fatias do save de job (`save_fatias` / `save_alocado`). O
--     que não foi consumido fica como "saldo em save de {nome}", sem job.
--
-- As duas views grandes são refeitas a partir do texto atual delas, com
-- trocas pontuais (`pg_temp.troca_unica`: cada trecho tem de aparecer uma vez
-- só, senão a migration para sem mudar nada). As colunas não mudam.
-- =============================================================================

-- ---------------------------------------------- vw_saves_consumos_financeiro
create or replace view public.vw_saves_consumos_financeiro as
 SELECT c.id,
    c.tenant_id,
    c.job_origem_id,
    c.job_item_orcado_id,
    c.valor,
    c.created_at,
    c.save_avulso_id
   FROM saves_consumos c
  WHERE ((c.job_item_orcado_id IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM saves_aprovacoes pa
          WHERE ((pa.job_item_orcado_id = c.job_item_orcado_id) AND (pa.situacao = 'aguardando'::save_aprovacao_situacao) AND (pa.momento = 'job_aberto'::text))))))
UNION ALL
 SELECT pa.id,
    pa.tenant_id,
    ((e.o ->> 'job_origem_id'::text))::uuid AS job_origem_id,
    pa.job_item_orcado_id,
    ((e.o ->> 'valor'::text))::numeric AS valor,
    COALESCE(sub.decidido_em, pa.enviado_em) AS created_at,
    ((e.o ->> 'save_avulso_id'::text))::uuid AS save_avulso_id
   FROM ((saves_aprovacoes pa
     CROSS JOIN LATERAL jsonb_array_elements(pa.origens_antes) e(o))
     LEFT JOIN saves_aprovacoes sub ON ((sub.id = pa.substitui_id)))
  WHERE ((pa.tipo = 'consome'::save_aprovacao_tipo) AND (pa.situacao = 'aguardando'::save_aprovacao_situacao) AND (pa.momento = 'job_aberto'::text) AND (pa.job_item_orcado_id IS NOT NULL));

-- ---------------------------------------------------- a troca conferida
create function pg_temp.troca_unica(texto text, antigo text, novo text)
returns text
language plpgsql
as $f$
declare
  n integer := (length(texto) - length(replace(texto, antigo, ''))) / length(antigo);
begin
  if n <> 1 then
    raise exception 'Trecho esperado uma vez, achado % vezes: %', n, left(antigo, 120);
  end if;
  return replace(texto, antigo, novo);
end $f$;

-- ------------------------------------------------------ vw_job_rentabilidade
do $$
declare
  v text := pg_get_viewdef('public.vw_job_rentabilidade'::regclass);
begin
  v := pg_temp.troca_unica(v, '), base AS (', $t$), migrado_avulso AS (
         SELECT oc.job_id AS job_consumidor,
            sum(((c.valor / NULLIF(sa.credito, (0)::numeric)) * sa.valor_nf)) AS previsto
           FROM ((vw_saves_consumos_financeiro c
             JOIN jobs_itens_orcado oc ON ((oc.id = c.job_item_orcado_id)))
             JOIN saves_avulsos sa ON ((sa.id = c.save_avulso_id)))
          WHERE ((c.job_item_orcado_id IS NOT NULL) AND save_avulso_emitido(sa.id))
          GROUP BY oc.job_id
        ), base AS ($t$);
  v := pg_temp.troca_unica(v,
    '+ COALESCE(mg.previsto, (0)::numeric)), 2) AS faturamento_previsto',
    '+ COALESCE(mg.previsto, (0)::numeric)) + COALESCE(ma.previsto, (0)::numeric), 2) AS faturamento_previsto');
  -- No realizado vale inteira: a nota do save avulso já foi emitida.
  v := pg_temp.troca_unica(v,
    '+ COALESCE(mg.realizado, (0)::numeric)), 2) AS faturamento_realizado',
    '+ COALESCE(mg.realizado, (0)::numeric)) + COALESCE(ma.previsto, (0)::numeric), 2) AS faturamento_realizado');
  v := pg_temp.troca_unica(v,
    'LEFT JOIN migrado mg ON ((mg.job_consumidor = j.id)))',
    'LEFT JOIN migrado mg ON ((mg.job_consumidor = j.id))) LEFT JOIN migrado_avulso ma ON ((ma.job_consumidor = j.id))');
  execute 'create or replace view public.vw_job_rentabilidade with (security_invoker = true) as ' || v;
end $$;

-- ----------------------------------------------------------- vw_fluxo_caixa
do $$
declare
  v text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  p1 integer;
  p2 integer;
begin
  -- 1. O recebimento da nota do save avulso é "saldo em save" dele, e não
  --    receita própria sem job.
  v := pg_temp.troca_unica(v,
    'WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor_proprio > (0)::numeric))',
    'WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor_proprio > (0)::numeric) AND (NOT (EXISTS ( SELECT 1 FROM saves_avulsos sa WHERE (sa.faturamento_id = tp.faturamento_id)))))');
  v := pg_temp.troca_unica(v,
    'WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor > tp.valor_proprio))) rat ON (true))',
    $t$WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor > tp.valor_proprio))
                UNION ALL
                 SELECT NULL::uuid AS uuid,
                    1.0,
                    sa.id
                   FROM (titulos_receber tr2
                     JOIN saves_avulsos sa ON ((sa.faturamento_id = tr2.faturamento_id)))
                  WHERE ((tr2.id = l.titulo_receber_id) AND (l.job_id IS NULL))) rat ON (true))$t$);

  -- 2. O título em aberto da nota do save avulso também é fatia de save.
  v := pg_temp.troca_unica(v,
    'WHERE ((t.status = ''em_aberto''::titulo_receber_status) AND (t.valor > tp.valor_proprio))',
    $t$WHERE ((t.status = 'em_aberto'::titulo_receber_status) AND (t.valor > tp.valor_proprio))
        UNION ALL
         SELECT sa.id,
            'previsto'::text AS text,
            'titulo'::text AS text,
            'titulo_save'::text AS text,
            t.id,
            t.tenant_id,
            t.empresa_id,
            NULL::uuid AS uuid,
            COALESCE(t.data_previsao_recebimento, t.data_vencimento) AS "coalesce",
            ((t.valor * ((1)::numeric - (COALESCE(( SELECT sum((lb.valor + COALESCE(( SELECT sum(rb.valor) AS sum
                           FROM baixas_retencoes rb
                          WHERE (rb.lancamento_id = lb.id)), (0)::numeric))) AS sum
                   FROM lancamentos_financeiros lb
                  WHERE ((lb.origem = 'titulo_baixa'::origem_lancamento) AND (lb.titulo_receber_id = t.id))), (0)::numeric) / NULLIF(t.valor, (0)::numeric)))))::numeric(14,2) AS "numeric",
            ((('Título NF '::text || f.numero_nf) || '/'::text) || (t.numero_parcela)::text),
            f.cliente_id,
            f.fornecedor_id,
            t.regional_id,
            NULL::text AS text
           FROM ((titulos_receber t
             JOIN faturamentos f ON ((f.id = t.faturamento_id)))
             JOIN saves_avulsos sa ON ((sa.faturamento_id = t.faturamento_id)))
          WHERE ((t.status = 'em_aberto'::titulo_receber_status) AND (f.status <> 'cancelado'::faturamento_status))$t$);

  -- 3. ... e sai da previsão própria (sem job) dos títulos.
  v := pg_temp.troca_unica(v,
    'WHERE ((t.status = ''em_aberto''::titulo_receber_status) AND (tp.valor_proprio > (0)::numeric))',
    'WHERE ((t.status = ''em_aberto''::titulo_receber_status) AND (tp.valor_proprio > (0)::numeric) AND (NOT (EXISTS ( SELECT 1 FROM saves_avulsos sa WHERE (sa.faturamento_id = t.faturamento_id)))))');

  -- 4. O consumo do save avulso entra na fila de consumo, pela origem dele:
  --    consumo ÷ crédito × valor da NF.
  p1 := position('save_consumo_ord AS (' in v);
  p2 := position('), save_alocado AS (' in v);
  if p1 = 0 or p2 = 0 or p2 < p1 then
    raise exception 'save_consumo_ord não encontrado em vw_fluxo_caixa';
  end if;
  v := substring(v from 1 for p1 - 1) || $t$save_consumo_ord AS (
         SELECT x.job_origem_id,
            x.job_consumidor,
            x.id,
            x.valor,
            (sum(x.valor) OVER w2 - x.valor) AS ini,
            sum(x.valor) OVER w2 AS fim
           FROM ( SELECT c.job_origem_id,
                    oc.job_id AS job_consumidor,
                    c.id,
                    c.created_at,
                    (((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2) AS valor
                   FROM (((vw_saves_consumos_financeiro c
                     JOIN jobs_itens_orcado oc ON ((oc.id = c.job_item_orcado_id)))
                     JOIN jobs jo ON ((jo.id = c.job_origem_id)))
                     JOIN save_gerado g ON ((g.job_id = c.job_origem_id)))
                  WHERE (c.job_item_orcado_id IS NOT NULL)
                UNION ALL
                 SELECT c.save_avulso_id,
                    oc.job_id,
                    c.id,
                    c.created_at,
                    (((c.valor / NULLIF(sa.credito, (0)::numeric)) * sa.valor_nf))::numeric(14,2)
                   FROM ((vw_saves_consumos_financeiro c
                     JOIN jobs_itens_orcado oc ON ((oc.id = c.job_item_orcado_id)))
                     JOIN saves_avulsos sa ON ((sa.id = c.save_avulso_id)))
                  WHERE (c.job_item_orcado_id IS NOT NULL)) x
          WINDOW w2 AS (PARTITION BY x.job_origem_id ORDER BY x.created_at, x.id)
        $t$ || substring(v from p2);

  -- 5. Os textos dizem o nome do save avulso onde diriam o código do job.
  v := pg_temp.troca_unica(v,
    'COALESCE(sj.codigo, ''—''::text)',
    'COALESCE(sj.codigo, ( SELECT sa.nome FROM saves_avulsos sa WHERE (sa.id = f.save_job_id)), ''—''::text)');
  v := pg_temp.troca_unica(v,
    'COALESCE(so.codigo, ''—''::text)',
    'COALESCE(so.codigo, ( SELECT sa.nome FROM saves_avulsos sa WHERE (sa.id = a.save_job_id)), ''—''::text)');

  execute 'create or replace view public.vw_fluxo_caixa as ' || v;
end $$;
