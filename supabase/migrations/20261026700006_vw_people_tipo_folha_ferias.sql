-- Migration: 20261026700006_vw_people_tipo_folha_ferias.sql
--
-- Reconstrói as 2 views para:
--   1. Usar folhas_pagamento como única fonte-verdade pra todos os tipos
--      (salario, ferias, decimo_terceiro_*). A CTE "ferias" separada a partir de
--      colaboradores_ferias_lancamentos é REMOVIDA — férias só aparecem depois que
--      a folha foi criada (fluxo real: RH aprova → cria folha).
--   2. Expor a nova coluna tipo_folha_ferias (usufruto | abono | null).
--   3. Label rico por tipo:
--      - salario         → "Folha mensal · outubro/2026"
--      - ferias usufruto → "Férias · DD/MM a DD/MM"
--      - ferias abono    → "Abono de férias · N dias"
--      - decimo_p1       → "13° — 1ª parcela · AAAA"
--      - decimo_p2       → "13° — 2ª parcela · AAAA"
--   4. escopo_id por linha:
--      - salario  → folhas_pagamento.id
--      - ferias*  → folhas_pagamento.lancamento_ferias_id
--      - decimo*  → NULL (stub; LEFT JOIN em colaboradores_nf_anexos → nf_anexada=false)
--   5. valor é CAST pra numeric (sem escala) pra manter compatibilidade com a
--      coluna já existente nas views anteriores (numeric(14,2) → numeric causaria
--      erro em CREATE OR REPLACE).
--
-- Spec: docs/superpowers/specs/2026-10-26-quadro-nf-colaborador-design.md
-- Ruling: progress.md "Task 4-6 redesenhadas"

-- ============================================================
-- 1. RECRIA vw_nf_pendentes_colaborador
-- ============================================================

CREATE OR REPLACE VIEW public.vw_nf_pendentes_colaborador
WITH (security_invoker = on) AS
WITH todas_folhas AS (
  SELECT
    f.tenant_id,
    f.colaborador_id,
    -- escopo_tipo
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
    -- escopo_id
    CASE f.tipo
      WHEN 'salario'  THEN f.id
      WHEN 'ferias'   THEN f.lancamento_ferias_id
      ELSE                 NULL::uuid
    END                                                                    AS escopo_id,
    -- label
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
            'Abono de férias · ' || COALESCE(fl.dias::text, '?') || ' dias'
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
    -- cast pra numeric (sem escala) pra manter tipo da coluna existente na view
    f.salario_base::numeric                                                AS valor,
    -- prazo_anexo
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
  -- nf_anexada: true quando já existe um anexo pra este escopo
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

COMMENT ON VIEW public.vw_nf_pendentes_colaborador IS
  'Quadro de NFs pendentes do colaborador. Fonte única: folhas_pagamento.
   ATENÇÃO: caller PRECISA filtrar WHERE colaborador_id = <id do colaborador logado>.
   tipo_folha_ferias: ''usufruto'' | ''abono'' | null (null quando tipo != ferias).
   escopo_id: folha.id pra salario; lancamento_ferias_id pra ferias; NULL pra 13° (stub).';

-- ============================================================
-- 2. RECRIA vw_people_aprovar_financeiro
-- ============================================================

CREATE OR REPLACE VIEW public.vw_people_aprovar_financeiro
WITH (security_invoker = on) AS
WITH todas_folhas_pend AS (
  SELECT
    f.tenant_id,
    f.colaborador_id,
    f.id                                                                   AS linha_id,
    -- escopo_tipo
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
    -- escopo_id
    CASE f.tipo
      WHEN 'salario'  THEN f.id
      WHEN 'ferias'   THEN f.lancamento_ferias_id
      ELSE                 NULL::uuid
    END                                                                    AS escopo_id,
    -- label
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
            'Abono de férias · ' || COALESCE(fl.dias::text, '?') || ' dias'
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
    -- prazo_anexo
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
  -- NF
  (n.id IS NOT NULL)                                                       AS nf_anexada,
  n.id                                                                     AS nf_anexo_id,
  n.arquivo_nome                                                           AS nf_arquivo_nome,
  n.uploaded_at                                                            AS nf_uploaded_at,
  -- Dados do colaborador
  c.tipo_contratacao,
  c.funcao,
  tf.origem,
  -- alocacao_resumo: apenas pra folha_mensal
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
