-- =====================================================================
-- Fix: label "Abono de férias · N dias" usa dias_abono (não dias total)
--
-- Por que: em abono_combinado, `colaboradores_ferias_lancamentos.dias`
-- é o TOTAL do lançamento (usufruto + vendidos) — 30 pro Antonio TESTE.
-- `dias_abono` é só a parte vendida — 10. A view usava `dias` nos dois
-- casos, então a linha de abono aparecia "Abono de férias · 30 dias"
-- em vez de "· 10 dias".
--
-- Pros tipos abono_avulso e abono_excepcional, `dias` já corresponde
-- à parte vendida (não há usufruto), e `dias_abono` é 0. Então
-- continuamos usando `dias` nesses casos.
--
-- Regra do label de abono: abono_combinado → dias_abono; demais → dias.
--
-- Mudança aditiva (CREATE OR REPLACE das 2 views; não altera dados).
-- =====================================================================

CREATE OR REPLACE VIEW public.vw_nf_pendentes_colaborador
WITH (security_invoker = on) AS
WITH todas_folhas AS (
  SELECT
    f.tenant_id,
    f.colaborador_id,
    CASE f.tipo
      WHEN 'salario'                    THEN 'folha_mensal'::nf_anexo_escopo
      WHEN 'ferias' THEN
        CASE f.tipo_folha_ferias
          WHEN 'usufruto'               THEN 'ferias_usufruto'::nf_anexo_escopo
          WHEN 'abono'                  THEN 'ferias_abono'::nf_anexo_escopo
          ELSE                               'ferias_usufruto'::nf_anexo_escopo
        END
      WHEN 'decimo_terceiro_1a_parcela' THEN 'decimo_terceiro_p1'::nf_anexo_escopo
      WHEN 'decimo_terceiro_2a_parcela' THEN 'decimo_terceiro_p2'::nf_anexo_escopo
      ELSE                                   'folha_mensal'::nf_anexo_escopo
    END                                                                    AS escopo_tipo,
    CASE f.tipo
      WHEN 'salario'  THEN f.id
      WHEN 'ferias'   THEN f.lancamento_ferias_id
      ELSE                 NULL::uuid
    END                                                                    AS escopo_id,
    CASE f.tipo
      WHEN 'salario' THEN
        'Folha mensal · ' || to_char(
          make_date(f.competencia_ano::int, f.competencia_mes::int, 1),
          'TMMonth/YYYY'
        )
      WHEN 'ferias' THEN
        CASE f.tipo_folha_ferias
          WHEN 'usufruto' THEN
            'Férias · ' || to_char(fl.data_inicio, 'DD/MM') || ' a ' || to_char(fl.data_fim, 'DD/MM')
          WHEN 'abono' THEN
            'Abono de férias · ' || COALESCE(
              CASE fl.tipo
                WHEN 'abono_combinado' THEN fl.dias_abono::text
                ELSE fl.dias::text
              END,
              '?'
            ) || ' dias'
          ELSE
            'Férias · ' || to_char(fl.data_inicio, 'DD/MM') || ' a ' || to_char(fl.data_fim, 'DD/MM')
        END
      WHEN 'decimo_terceiro_1a_parcela' THEN
        '13° — 1ª parcela · ' || f.competencia_ano::text
      WHEN 'decimo_terceiro_2a_parcela' THEN
        '13° — 2ª parcela · ' || f.competencia_ano::text
      ELSE f.tipo::text
    END                                                                    AS label,
    f.competencia_ano::int                                                 AS competencia_ano,
    f.competencia_mes::int                                                 AS competencia_mes,
    f.salario_base::numeric                                                AS valor,
    CASE f.tipo
      WHEN 'salario' THEN
        (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + INTERVAL '1 month 2 days')::date
      WHEN 'ferias' THEN
        (fl.data_inicio - INTERVAL '2 days')::date
      ELSE NULL::date
    END                                                                    AS prazo_anexo,
    f.tipo_folha_ferias                                                    AS tipo_folha_ferias,
    f.status::text                                                         AS _folha_status
  FROM public.folhas_pagamento f
  LEFT JOIN public.colaboradores_ferias_lancamentos fl
    ON fl.id = f.lancamento_ferias_id
  WHERE f.status NOT IN ('paga')
    AND (f.competencia_ano * 100 + f.competencia_mes) >= 202610
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
  (n.id IS NOT NULL)                                                       AS nf_anexada,
  n.id                                                                     AS nf_anexo_id,
  n.arquivo_nome                                                           AS nf_arquivo_nome,
  n.uploaded_at                                                            AS nf_uploaded_at,
  tf.tipo_folha_ferias
FROM todas_folhas tf
LEFT JOIN public.colaboradores_nf_anexos n
  ON n.tenant_id      = tf.tenant_id
 AND n.colaborador_id = tf.colaborador_id
 AND n.escopo_tipo    = tf.escopo_tipo
 AND n.escopo_id      = tf.escopo_id
WHERE tf._folha_status <> 'paga';

GRANT SELECT ON public.vw_nf_pendentes_colaborador TO authenticated;

CREATE OR REPLACE VIEW public.vw_people_aprovar_financeiro
WITH (security_invoker = on) AS
WITH todas_folhas_pend AS (
  SELECT
    f.tenant_id,
    f.colaborador_id,
    f.id                                                                   AS linha_id,
    CASE f.tipo
      WHEN 'salario'                    THEN 'folha_mensal'::nf_anexo_escopo
      WHEN 'ferias' THEN
        CASE f.tipo_folha_ferias
          WHEN 'usufruto'               THEN 'ferias_usufruto'::nf_anexo_escopo
          WHEN 'abono'                  THEN 'ferias_abono'::nf_anexo_escopo
          ELSE                               'ferias_usufruto'::nf_anexo_escopo
        END
      WHEN 'decimo_terceiro_1a_parcela' THEN 'decimo_terceiro_p1'::nf_anexo_escopo
      WHEN 'decimo_terceiro_2a_parcela' THEN 'decimo_terceiro_p2'::nf_anexo_escopo
      ELSE                                   'folha_mensal'::nf_anexo_escopo
    END                                                                    AS escopo_tipo,
    CASE f.tipo
      WHEN 'salario'  THEN f.id
      WHEN 'ferias'   THEN f.lancamento_ferias_id
      ELSE                 NULL::uuid
    END                                                                    AS escopo_id,
    CASE f.tipo
      WHEN 'salario' THEN
        'Folha mensal · ' || to_char(
          make_date(f.competencia_ano::int, f.competencia_mes::int, 1),
          'TMMonth/YYYY'
        )
      WHEN 'ferias' THEN
        CASE f.tipo_folha_ferias
          WHEN 'usufruto' THEN
            'Férias · ' || to_char(fl.data_inicio, 'DD/MM') || ' a ' || to_char(fl.data_fim, 'DD/MM')
          WHEN 'abono' THEN
            'Abono de férias · ' || COALESCE(
              CASE fl.tipo
                WHEN 'abono_combinado' THEN fl.dias_abono::text
                ELSE fl.dias::text
              END,
              '?'
            ) || ' dias'
          ELSE
            'Férias · ' || to_char(fl.data_inicio, 'DD/MM') || ' a ' || to_char(fl.data_fim, 'DD/MM')
        END
      WHEN 'decimo_terceiro_1a_parcela' THEN
        '13° — 1ª parcela · ' || f.competencia_ano::text
      WHEN 'decimo_terceiro_2a_parcela' THEN
        '13° — 2ª parcela · ' || f.competencia_ano::text
      ELSE f.tipo::text
    END                                                                    AS label,
    f.competencia_ano::int                                                 AS competencia_ano,
    f.competencia_mes::int                                                 AS competencia_mes,
    f.salario_base::numeric                                                AS valor,
    CASE f.tipo
      WHEN 'salario' THEN
        (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + INTERVAL '1 month 2 days')::date
      WHEN 'ferias' THEN
        (fl.data_inicio - INTERVAL '2 days')::date
      ELSE NULL::date
    END                                                                    AS prazo_anexo,
    f.tipo_folha_ferias                                                    AS tipo_folha_ferias,
    f.origem                                                               AS origem
  FROM public.folhas_pagamento f
  LEFT JOIN public.colaboradores_ferias_lancamentos fl
    ON fl.id = f.lancamento_ferias_id
  WHERE f.status = 'enviada'
    AND (f.competencia_ano * 100 + f.competencia_mes) >= 202610
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
  (n.id IS NOT NULL)                                                       AS nf_anexada,
  n.id                                                                     AS nf_anexo_id,
  n.arquivo_nome                                                           AS nf_arquivo_nome,
  n.uploaded_at                                                            AS nf_uploaded_at,
  c.tipo_contratacao,
  c.funcao,
  tf.origem,
  (
    SELECT string_agg(a.percentual::text || '%', ' / ' ORDER BY a.percentual DESC)
    FROM public.folhas_pagamento_alocacoes a
    WHERE a.folha_id = tf.linha_id
      AND tf.escopo_tipo = 'folha_mensal'
  )                                                                        AS alocacao_resumo,
  tf.tipo_folha_ferias
FROM todas_folhas_pend tf
LEFT JOIN public.colaboradores_nf_anexos n
  ON n.tenant_id      = tf.tenant_id
 AND n.colaborador_id = tf.colaborador_id
 AND n.escopo_tipo    = tf.escopo_tipo
 AND n.escopo_id      = tf.escopo_id
LEFT JOIN public.colaboradores c
  ON c.id = tf.colaborador_id;

GRANT SELECT ON public.vw_people_aprovar_financeiro TO authenticated;
