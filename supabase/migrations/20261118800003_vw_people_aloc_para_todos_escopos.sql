-- =====================================================================
-- vw_people_aprovar_financeiro: alocacao_resumo para TODOS os escopos
-- =====================================================================
--
-- POR QUE
--
-- O subquery de `alocacao_resumo` tinha guard `AND tf.escopo_tipo =
-- 'folha_mensal'`. Isso espelhava a regra antiga "só folha mensal tem
-- rateio". Com o backfill (20261118800001) e a RPC
-- `replicar_alocacao_para_folha` (20261118800002), férias e 13º (parcelas
-- + adiantamento) também passam a ter linhas em
-- `folhas_pagamento_alocacoes`.
--
-- Removo o guard. A view continua com o mesmo shape (não quebra consumers).
--
-- A aba People do financeiro atualmente lê `folhas_pagamento_alocacoes`
-- direto (não usa esta coluna), mas a view ganha consistência pra
-- consumidores futuros.
-- =====================================================================

CREATE OR REPLACE VIEW public.vw_people_aprovar_financeiro AS
WITH folha_mensal_ferias AS (
  SELECT f.tenant_id,
         f.colaborador_id,
         f.id AS linha_id,
         CASE f.tipo
           WHEN 'salario'::folha_tipo THEN 'folha_mensal'::nf_anexo_escopo
           WHEN 'ferias'::folha_tipo  THEN
             CASE f.tipo_folha_ferias
               WHEN 'usufruto' THEN 'ferias_usufruto'::nf_anexo_escopo
               WHEN 'abono'    THEN 'ferias_abono'::nf_anexo_escopo
               ELSE                 'ferias_usufruto'::nf_anexo_escopo
             END
           ELSE NULL::nf_anexo_escopo
         END AS escopo_tipo,
         CASE f.tipo
           WHEN 'salario'::folha_tipo THEN f.id
           WHEN 'ferias'::folha_tipo  THEN f.lancamento_ferias_id
           ELSE NULL::uuid
         END AS escopo_id,
         CASE f.tipo
           WHEN 'salario'::folha_tipo THEN
             'Folha mensal · ' || mes_pt_br(f.competencia_mes::int)
             || '/' || f.competencia_ano::text
           WHEN 'ferias'::folha_tipo  THEN
             CASE f.tipo_folha_ferias
               WHEN 'usufruto' THEN
                 'Férias · ' || to_char(fl.data_inicio::timestamptz, 'DD/MM')
                 || ' a ' || to_char(fl.data_fim::timestamptz, 'DD/MM')
               WHEN 'abono' THEN
                 'Abono de férias · ' || COALESCE(
                   CASE fl.tipo
                     WHEN 'abono_combinado'::ferias_lancamento_tipo THEN fl.dias_abono::text
                     ELSE fl.dias::text
                   END, '?'
                 ) || ' dias'
               ELSE
                 'Férias · ' || to_char(fl.data_inicio::timestamptz, 'DD/MM')
                 || ' a ' || to_char(fl.data_fim::timestamptz, 'DD/MM')
             END
           ELSE NULL::text
         END AS label,
         f.competencia_ano::int AS competencia_ano,
         f.competencia_mes::int AS competencia_mes,
         f.salario_base::numeric AS valor,
         CASE f.tipo
           WHEN 'salario'::folha_tipo THEN
             (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + interval '1 month 2 days')::date
           WHEN 'ferias'::folha_tipo  THEN
             (fl.data_inicio - interval '2 days')::date
           ELSE NULL::date
         END AS prazo_anexo,
         f.tipo_folha_ferias,
         f.origem
  FROM folhas_pagamento f
  LEFT JOIN colaboradores_ferias_lancamentos fl ON fl.id = f.lancamento_ferias_id
  WHERE f.tipo IN ('salario'::folha_tipo, 'ferias'::folha_tipo)
    AND f.status = 'enviada'::folha_linha_status
    AND (f.competencia_ano * 100 + f.competencia_mes) >= 202610
),
decimo_parcelas AS (
  SELECT fp.tenant_id,
         fp.colaborador_id,
         fp.id AS linha_id,
         CASE fp.tipo
           WHEN 'decimo_terceiro_1a_parcela'::folha_tipo THEN 'decimo_terceiro_p1'::nf_anexo_escopo
           ELSE                                               'decimo_terceiro_p2'::nf_anexo_escopo
         END AS escopo_tipo,
         dtl.id AS escopo_id,
         CASE fp.tipo
           WHEN 'decimo_terceiro_1a_parcela'::folha_tipo THEN
             '13º ' || fp.competencia_ano::text || ' — 1ª parcela'
           ELSE
             '13º ' || fp.competencia_ano::text || ' — 2ª parcela'
         END AS label,
         fp.competencia_ano::int AS competencia_ano,
         fp.competencia_mes::int AS competencia_mes,
         fp.salario_base::numeric AS valor,
         COALESCE(
           fp.data_pagamento_prevista,
           CASE fp.tipo
             WHEN 'decimo_terceiro_1a_parcela'::folha_tipo THEN
               make_date(fp.competencia_ano::int, 11, 30)
             ELSE
               make_date(fp.competencia_ano::int, 12, 20)
           END
         ) AS prazo_anexo,
         NULL::text AS tipo_folha_ferias,
         fp.origem
  FROM folhas_pagamento fp
  JOIN decimo_terceiro_linhas dtl ON dtl.id = fp.decimo_terceiro_linha_id
  WHERE fp.tipo IN ('decimo_terceiro_1a_parcela'::folha_tipo, 'decimo_terceiro_2a_parcela'::folha_tipo)
    AND fp.status = 'enviada'::folha_linha_status
    AND (fp.competencia_ano * 100 + fp.competencia_mes) >= 202610
),
decimo_adiantamento AS (
  SELECT fp.tenant_id,
         fp.colaborador_id,
         fp.id AS linha_id,
         'decimo_terceiro_adiantamento'::nf_anexo_escopo AS escopo_tipo,
         dta.id AS escopo_id,
         '13º ' || dta.ano::text || ' — Adiantamento' AS label,
         fp.competencia_ano::int AS competencia_ano,
         fp.competencia_mes::int AS competencia_mes,
         fp.salario_base::numeric AS valor,
         COALESCE(fp.data_pagamento_prevista, dta.data) AS prazo_anexo,
         NULL::text AS tipo_folha_ferias,
         fp.origem
  FROM folhas_pagamento fp
  JOIN decimo_terceiro_adiantamentos dta ON dta.id = fp.decimo_terceiro_adiantamento_id
  WHERE fp.tipo = 'decimo_terceiro_adiantamento'::folha_tipo
    AND fp.status = 'enviada'::folha_linha_status
    AND (fp.competencia_ano * 100 + fp.competencia_mes) >= 202610
),
todas_folhas_pend AS (
  SELECT * FROM folha_mensal_ferias
  UNION ALL
  SELECT * FROM decimo_parcelas
  UNION ALL
  SELECT * FROM decimo_adiantamento
)
SELECT
  tf.tenant_id,
  tf.colaborador_id,
  tf.escopo_tipo,
  tf.escopo_id,
  tf.linha_id,
  tf.label,
  tf.competencia_ano,
  tf.competencia_mes,
  tf.valor,
  tf.prazo_anexo,
  n.id IS NOT NULL                     AS nf_anexada,
  n.id                                 AS nf_anexo_id,
  n.arquivo_nome                       AS nf_arquivo_nome,
  n.uploaded_at                        AS nf_uploaded_at,
  c.tipo_contratacao,
  c.funcao,
  tf.origem,
  (
    -- Guard removido (era `AND tf.escopo_tipo = 'folha_mensal'`):
    -- agora férias e 13º também têm snapshot em
    -- folhas_pagamento_alocacoes.
    SELECT string_agg(a.percentual::text || '%', ' / ' ORDER BY a.percentual DESC)
    FROM folhas_pagamento_alocacoes a
    WHERE a.folha_id = tf.linha_id
  ) AS alocacao_resumo,
  tf.tipo_folha_ferias
FROM todas_folhas_pend tf
LEFT JOIN colaboradores_nf_anexos n
  ON  n.tenant_id      = tf.tenant_id
  AND n.colaborador_id = tf.colaborador_id
  AND n.escopo_tipo    = tf.escopo_tipo
  AND n.escopo_id      = tf.escopo_id
LEFT JOIN colaboradores c ON c.id = tf.colaborador_id;

GRANT SELECT ON public.vw_people_aprovar_financeiro TO authenticated;
