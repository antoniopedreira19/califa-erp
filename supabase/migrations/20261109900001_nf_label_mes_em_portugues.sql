-- Migration: 20261109900001_nf_label_mes_em_portugues.sql
--
-- Antes: label de "Folha mensal" na tela do colaborador saía "Folha mensal · October/2026"
-- porque o `to_char(..., 'TMMonth/YYYY')` depende do `lc_time` do servidor Postgres,
-- que no Supabase hospedado é `en_US`. Resultado: nome do mês em inglês na UI.
--
-- Depois: helper imutável `public.mes_pt_br(int)` devolve o nome do mês em pt-BR,
-- e as duas views que compõem o label de folha mensal passam a usar o helper.
--   - vw_nf_pendentes_colaborador  (quadro de NF no perfil)
--   - vw_people_aprovar_financeiro (People do financeiro)
--
-- Nenhuma coluna muda de nome ou tipo — só o conteúdo do `label` quando escopo é folha mensal.

-- ============================================================
-- Helper: nome do mês em pt-BR
-- ============================================================
CREATE OR REPLACE FUNCTION public.mes_pt_br(p_mes int)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_mes
    WHEN  1 THEN 'Janeiro'
    WHEN  2 THEN 'Fevereiro'
    WHEN  3 THEN 'Março'
    WHEN  4 THEN 'Abril'
    WHEN  5 THEN 'Maio'
    WHEN  6 THEN 'Junho'
    WHEN  7 THEN 'Julho'
    WHEN  8 THEN 'Agosto'
    WHEN  9 THEN 'Setembro'
    WHEN 10 THEN 'Outubro'
    WHEN 11 THEN 'Novembro'
    WHEN 12 THEN 'Dezembro'
  END
$$;

GRANT EXECUTE ON FUNCTION public.mes_pt_br(int) TO authenticated;

-- ============================================================
-- VIEW 1: vw_nf_pendentes_colaborador
-- ============================================================
CREATE OR REPLACE VIEW public.vw_nf_pendentes_colaborador AS
WITH
folha_mensal_ferias AS (
  SELECT
    f.tenant_id,
    f.colaborador_id,
    CASE f.tipo
      WHEN 'salario'::folha_tipo  THEN 'folha_mensal'::nf_anexo_escopo
      WHEN 'ferias'::folha_tipo   THEN
        CASE f.tipo_folha_ferias
          WHEN 'usufruto' THEN 'ferias_usufruto'::nf_anexo_escopo
          WHEN 'abono'    THEN 'ferias_abono'::nf_anexo_escopo
          ELSE                 'ferias_usufruto'::nf_anexo_escopo
        END
    END AS escopo_tipo,
    CASE f.tipo
      WHEN 'salario'::folha_tipo THEN f.id
      WHEN 'ferias'::folha_tipo  THEN f.lancamento_ferias_id
    END AS escopo_id,
    CASE f.tipo
      WHEN 'salario'::folha_tipo THEN
        'Folha mensal · '
        || public.mes_pt_br(f.competencia_mes::int)
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
    END AS label,
    f.competencia_ano::int AS competencia_ano,
    f.competencia_mes::int AS competencia_mes,
    f.salario_base::numeric AS valor,
    CASE f.tipo
      WHEN 'salario'::folha_tipo THEN
        (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + interval '1 month 2 days')::date
      WHEN 'ferias'::folha_tipo  THEN
        (fl.data_inicio - interval '2 days')::date
    END AS prazo_anexo,
    f.tipo_folha_ferias,
    f.status::text AS _folha_status
  FROM folhas_pagamento f
  LEFT JOIN colaboradores_ferias_lancamentos fl ON fl.id = f.lancamento_ferias_id
  WHERE f.tipo IN ('salario'::folha_tipo, 'ferias'::folha_tipo)
    AND f.status <> 'paga'::folha_linha_status
    AND (f.competencia_ano * 100 + f.competencia_mes) >= 202610
    AND f.origem = 'california'::folha_origem
),
decimo_parcelas AS (
  SELECT
    fp.tenant_id,
    fp.colaborador_id,
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
    fp.status::text AS _folha_status
  FROM folhas_pagamento fp
  JOIN decimo_terceiro_linhas dtl ON dtl.id = fp.decimo_terceiro_linha_id
  JOIN colaboradores c ON c.id = fp.colaborador_id
  WHERE fp.tipo IN ('decimo_terceiro_1a_parcela'::folha_tipo, 'decimo_terceiro_2a_parcela'::folha_tipo)
    AND fp.origem = 'california'::folha_origem
    AND fp.status <> 'paga'::folha_linha_status
    AND c.tipo_contratacao IN ('pj', 'mei', 'clt_recibo')
    AND (fp.competencia_ano * 100 + fp.competencia_mes) >= 202610
),
decimo_adiantamento AS (
  SELECT
    fp.tenant_id,
    fp.colaborador_id,
    'decimo_terceiro_adiantamento'::nf_anexo_escopo AS escopo_tipo,
    dta.id AS escopo_id,
    '13º ' || dta.ano::text || ' — Adiantamento' AS label,
    fp.competencia_ano::int AS competencia_ano,
    fp.competencia_mes::int AS competencia_mes,
    fp.salario_base::numeric AS valor,
    COALESCE(fp.data_pagamento_prevista, dta.data) AS prazo_anexo,
    NULL::text AS tipo_folha_ferias,
    fp.status::text AS _folha_status
  FROM folhas_pagamento fp
  JOIN decimo_terceiro_adiantamentos dta ON dta.id = fp.decimo_terceiro_adiantamento_id
  JOIN colaboradores c ON c.id = fp.colaborador_id
  WHERE fp.tipo = 'decimo_terceiro_adiantamento'::folha_tipo
    AND fp.origem = 'california'::folha_origem
    AND fp.status <> 'paga'::folha_linha_status
    AND c.tipo_contratacao IN ('pj', 'mei', 'clt_recibo')
    AND (fp.competencia_ano * 100 + fp.competencia_mes) >= 202610
),
todas_folhas AS (
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
  tf.label,
  tf.competencia_ano,
  tf.competencia_mes,
  tf.valor,
  tf.prazo_anexo,
  n.id IS NOT NULL                     AS nf_anexada,
  n.id                                 AS nf_anexo_id,
  n.arquivo_nome                       AS nf_arquivo_nome,
  n.uploaded_at                        AS nf_uploaded_at,
  tf.tipo_folha_ferias
FROM todas_folhas tf
LEFT JOIN colaboradores_nf_anexos n
  ON  n.tenant_id      = tf.tenant_id
  AND n.colaborador_id = tf.colaborador_id
  AND n.escopo_tipo    = tf.escopo_tipo
  AND n.escopo_id      = tf.escopo_id
WHERE tf._folha_status <> 'paga';

GRANT SELECT ON public.vw_nf_pendentes_colaborador TO authenticated;

-- ============================================================
-- VIEW 2: vw_people_aprovar_financeiro
-- ============================================================
CREATE OR REPLACE VIEW public.vw_people_aprovar_financeiro AS
WITH
folha_mensal_ferias AS (
  SELECT
    f.tenant_id,
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
    END AS escopo_tipo,
    CASE f.tipo
      WHEN 'salario'::folha_tipo THEN f.id
      WHEN 'ferias'::folha_tipo  THEN f.lancamento_ferias_id
    END AS escopo_id,
    CASE f.tipo
      WHEN 'salario'::folha_tipo THEN
        'Folha mensal · '
        || public.mes_pt_br(f.competencia_mes::int)
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
    END AS label,
    f.competencia_ano::int AS competencia_ano,
    f.competencia_mes::int AS competencia_mes,
    f.salario_base::numeric AS valor,
    CASE f.tipo
      WHEN 'salario'::folha_tipo THEN
        (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + interval '1 month 2 days')::date
      WHEN 'ferias'::folha_tipo  THEN
        (fl.data_inicio - interval '2 days')::date
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
  SELECT
    fp.tenant_id,
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
  SELECT
    fp.tenant_id,
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
    SELECT string_agg(a.percentual::text || '%', ' / ' ORDER BY a.percentual DESC)
    FROM folhas_pagamento_alocacoes a
    WHERE a.folha_id = tf.linha_id
      AND tf.escopo_tipo = 'folha_mensal'::nf_anexo_escopo
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
