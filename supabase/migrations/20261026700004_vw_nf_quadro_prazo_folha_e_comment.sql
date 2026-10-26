-- Migration: 20261026700004_vw_nf_quadro_prazo_folha_e_comment.sql
-- Fix review I2 + M2 (upgrade) sobre a migration 20261026700003.
--
-- I2: adiciona COMMENT em vw_nf_pendentes_colaborador documentando que o caller
--     PRECISA filtrar WHERE colaborador_id = <id do colaborador logado>.
--     A view usa security_invoker=on; policies das tabelas-fonte não cobrem o
--     role "colaborador" nativo para todos os registros — o filtro no caller
--     é o guard-rail real.
--
-- M2 (upgrade→Important): corrige prazo_anexo de folhas mensais.
--     Antes: make_date(ano, mes, 3)  → dia 03 do mês da competência (errado)
--     Depois: (make_date(ano, mes, 1) + INTERVAL '1 month 2 days')::date
--             → dia 03 do mês SEGUINTE à competência (conforme docs/decisions/132)
--
--     Exemplo: competência 2026-10 → prazo_anexo = 2026-11-03 (correto)
--              Antes produzia 2026-10-03 → "em atraso" imediato (incorreto)
--
-- Estratégia: CREATE OR REPLACE VIEW nas 2 views (aditivo, sem DROP).
--   As políticas da migration 20261026700003 (DROP POLICY IF EXISTS + CREATE POLICY)
--   NÃO são replicadas aqui — já estão aplicadas e são idempotentes se necessário.

-- ============================================================
-- 1. RECRIA vw_nf_pendentes_colaborador com prazo corrigido
-- ============================================================

CREATE OR REPLACE VIEW public.vw_nf_pendentes_colaborador
WITH (security_invoker = on) AS
WITH folhas AS (
  -- Folhas mensais ainda não pagas, a partir do cutoff outubro/2026
  SELECT
    f.tenant_id,
    f.colaborador_id,
    'folha_mensal'::nf_anexo_escopo                                    AS escopo_tipo,
    f.id                                                               AS escopo_id,
    -- label: "Folha mensal · outubro/2026"
    'Folha mensal · ' || to_char(
      make_date(f.competencia_ano::int, f.competencia_mes::int, 1),
      'TMMonth/YYYY'
    )                                                                  AS label,
    f.competencia_ano::int                                             AS competencia_ano,
    f.competencia_mes::int                                             AS competencia_mes,
    f.salario_base                                                     AS valor,
    -- prazo: dia 03 do mês SEGUINTE à competência (fix M2 — antes era dia 3 do próprio mês)
    (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + INTERVAL '1 month 2 days')::date
                                                                       AS prazo_anexo,
    -- para o filtro de "já paga" usamos f.status diretamente (sem conta_avulsa_id)
    f.status::text                                                     AS _folha_status,
    NULL::uuid                                                         AS _conta_avulsa_id
  FROM public.folhas_pagamento f
  WHERE f.status NOT IN ('paga')
    AND (f.competencia_ano * 100 + f.competencia_mes) >= 202610
),
ferias_base AS (
  -- Lançamentos de férias/abono aguardando financeiro ou já aprovados (não concluídos)
  -- excluindo linhas cujo título já foi baixado
  SELECT
    l.tenant_id,
    l.colaborador_id,
    l.id                                                               AS lancamento_id,
    l.tipo,
    l.data_inicio,
    l.data_fim,
    l.dias,
    l.valor_ferias,
    l.valor_um_terco,
    l.valor_abono,
    l.conta_avulsa_id,
    -- prazo: data_inicio - 2 dias (regra de pagamento de férias)
    (l.data_inicio - INTERVAL '2 days')::date                         AS prazo_ferias,
    -- competência: ano/mês da data_inicio
    extract(year  from l.data_inicio)::int                            AS comp_ano,
    extract(month from l.data_inicio)::int                            AS comp_mes
  FROM public.colaboradores_ferias_lancamentos l
  WHERE l.status IN ('aguardando_financeiro', 'aprovado')
    AND (
      extract(year from l.data_inicio)::int * 100
      + extract(month from l.data_inicio)::int
    ) >= 202610
),
ferias AS (
  -- Linha usufruto para: usufruto, abono_excepcional
  -- e linha usufruto do abono_combinado
  SELECT
    fb.tenant_id,
    fb.colaborador_id,
    'ferias_usufruto'::nf_anexo_escopo                                 AS escopo_tipo,
    fb.lancamento_id                                                   AS escopo_id,
    'Férias · ' || to_char(fb.data_inicio, 'DD/MM') || ' a ' || to_char(fb.data_fim, 'DD/MM')
                                                                       AS label,
    fb.comp_ano                                                        AS competencia_ano,
    fb.comp_mes                                                        AS competencia_mes,
    -- valor usufruto = ferias + 1/3
    (COALESCE(fb.valor_ferias, 0) + COALESCE(fb.valor_um_terco, 0))   AS valor,
    fb.prazo_ferias                                                    AS prazo_anexo,
    NULL::text                                                         AS _folha_status,
    fb.conta_avulsa_id                                                 AS _conta_avulsa_id
  FROM ferias_base fb
  WHERE fb.tipo IN ('usufruto', 'abono_combinado', 'abono_excepcional')

  UNION ALL

  -- Linha abono para: abono_avulso, abono_combinado, abono_excepcional (quando tem valor_abono)
  SELECT
    fb.tenant_id,
    fb.colaborador_id,
    'ferias_abono'::nf_anexo_escopo                                    AS escopo_tipo,
    fb.lancamento_id                                                   AS escopo_id,
    'Abono · ' || fb.dias::text || ' dias'                             AS label,
    fb.comp_ano                                                        AS competencia_ano,
    fb.comp_mes                                                        AS competencia_mes,
    COALESCE(fb.valor_abono, 0)                                        AS valor,
    fb.prazo_ferias                                                    AS prazo_anexo,
    NULL::text                                                         AS _folha_status,
    fb.conta_avulsa_id                                                 AS _conta_avulsa_id
  FROM ferias_base fb
  WHERE fb.tipo IN ('abono_avulso', 'abono_combinado', 'abono_excepcional')
    AND COALESCE(fb.valor_abono, 0) > 0
),
decimo AS (
  -- Stub: parcelas de 13° — linha aparece quando folha de 13° atingir fechada_parcial_*.
  -- Enquanto o fluxo de pagamento do 13° não existir, nenhuma linha é retornada.
  SELECT
    NULL::uuid                     AS tenant_id,
    NULL::uuid                     AS colaborador_id,
    'decimo_terceiro_p1'::nf_anexo_escopo AS escopo_tipo,
    NULL::uuid                     AS escopo_id,
    NULL::text                     AS label,
    NULL::int                      AS competencia_ano,
    NULL::int                      AS competencia_mes,
    NULL::numeric                  AS valor,
    NULL::date                     AS prazo_anexo,
    NULL::text                     AS _folha_status,
    NULL::uuid                     AS _conta_avulsa_id
  WHERE false
),
uniao AS (
  SELECT * FROM folhas
  UNION ALL SELECT * FROM ferias
  UNION ALL SELECT * FROM decimo
)
SELECT
  u.tenant_id,
  u.colaborador_id,
  u.escopo_tipo,
  u.escopo_id,
  u.label,
  u.competencia_ano,
  u.competencia_mes,
  u.valor,
  u.prazo_anexo,
  -- nf_anexada: true quando já existe um anexo para este escopo
  (n.id IS NOT NULL)                                                   AS nf_anexada,
  n.id                                                                 AS nf_anexo_id,
  n.arquivo_nome                                                       AS nf_arquivo_nome,
  n.uploaded_at                                                        AS nf_uploaded_at
FROM uniao u
-- filtro de "já paga" via conta_avulsa (férias/13°): exclui quando baixada
LEFT JOIN public.contas_avulsas ca
  ON ca.id = u._conta_avulsa_id
-- join do anexo de NF por escopo
LEFT JOIN public.colaboradores_nf_anexos n
  ON n.tenant_id    = u.tenant_id
 AND n.colaborador_id = u.colaborador_id
 AND n.escopo_tipo  = u.escopo_tipo
 AND n.escopo_id    = u.escopo_id
-- exclui folhas já pagas (detectado via coluna auxiliar _folha_status)
-- exclui férias cujo título já foi baixado
WHERE (u._folha_status IS NULL OR u._folha_status <> 'paga')
  AND ca.status IS DISTINCT FROM 'baixada';

GRANT SELECT ON public.vw_nf_pendentes_colaborador TO authenticated;

-- ============================================================
-- 2. COMMENT — documenta dependência do filtro do caller (fix I2)
-- ============================================================

COMMENT ON VIEW public.vw_nf_pendentes_colaborador IS
  'Quadro de NFs pendentes do colaborador. ATENÇÃO: server component CONSUMIDOR
   PRECISA filtrar WHERE colaborador_id = <id do colaborador logado>. A view usa
   security_invoker=on; policies das tabelas-fonte (folhas_pagamento,
   colaboradores_ferias_lancamentos) hoje não cobrem o role "colaborador" nativo
   para todos os registros. O filtro no caller é o guard-rail real.';

-- ============================================================
-- 3. RECRIA vw_people_aprovar_financeiro com prazo corrigido
-- ============================================================

CREATE OR REPLACE VIEW public.vw_people_aprovar_financeiro
WITH (security_invoker = on) AS
WITH folhas_pend AS (
  SELECT
    f.tenant_id,
    f.colaborador_id,
    'folha_mensal'::nf_anexo_escopo                                    AS escopo_tipo,
    f.id                                                               AS escopo_id,
    f.id                                                               AS linha_id,
    'Folha mensal · ' || to_char(
      make_date(f.competencia_ano::int, f.competencia_mes::int, 1),
      'TMMonth/YYYY'
    )                                                                  AS label,
    f.competencia_ano::int                                             AS competencia_ano,
    f.competencia_mes::int                                             AS competencia_mes,
    f.salario_base                                                     AS valor,
    -- prazo: dia 03 do mês SEGUINTE à competência (fix M2)
    (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + INTERVAL '1 month 2 days')::date
                                                                       AS prazo_anexo,
    f.origem                                                           AS origem,
    NULL::uuid                                                         AS _conta_avulsa_id
  FROM public.folhas_pagamento f
  WHERE f.status = 'enviada'
    AND (f.competencia_ano * 100 + f.competencia_mes) >= 202610
),
ferias_pend_base AS (
  SELECT
    l.tenant_id,
    l.colaborador_id,
    l.id                                                               AS lancamento_id,
    l.tipo,
    l.data_inicio,
    l.data_fim,
    l.dias,
    l.valor_ferias,
    l.valor_um_terco,
    l.valor_abono,
    l.conta_avulsa_id,
    (l.data_inicio - INTERVAL '2 days')::date                         AS prazo_ferias,
    extract(year  from l.data_inicio)::int                            AS comp_ano,
    extract(month from l.data_inicio)::int                            AS comp_mes
  FROM public.colaboradores_ferias_lancamentos l
  WHERE l.status = 'aguardando_financeiro'
    AND (
      extract(year from l.data_inicio)::int * 100
      + extract(month from l.data_inicio)::int
    ) >= 202610
),
ferias_pend AS (
  -- Linha usufruto
  SELECT
    fb.tenant_id,
    fb.colaborador_id,
    'ferias_usufruto'::nf_anexo_escopo                                 AS escopo_tipo,
    fb.lancamento_id                                                   AS escopo_id,
    fb.lancamento_id                                                   AS linha_id,
    'Férias · ' || to_char(fb.data_inicio, 'DD/MM') || ' a ' || to_char(fb.data_fim, 'DD/MM')
                                                                       AS label,
    fb.comp_ano                                                        AS competencia_ano,
    fb.comp_mes                                                        AS competencia_mes,
    (COALESCE(fb.valor_ferias, 0) + COALESCE(fb.valor_um_terco, 0))   AS valor,
    fb.prazo_ferias                                                    AS prazo_anexo,
    NULL::folha_origem                                                 AS origem,
    fb.conta_avulsa_id                                                 AS _conta_avulsa_id
  FROM ferias_pend_base fb
  WHERE fb.tipo IN ('usufruto', 'abono_combinado', 'abono_excepcional')

  UNION ALL

  -- Linha abono
  SELECT
    fb.tenant_id,
    fb.colaborador_id,
    'ferias_abono'::nf_anexo_escopo                                    AS escopo_tipo,
    fb.lancamento_id                                                   AS escopo_id,
    fb.lancamento_id                                                   AS linha_id,
    'Abono · ' || fb.dias::text || ' dias'                             AS label,
    fb.comp_ano                                                        AS competencia_ano,
    fb.comp_mes                                                        AS competencia_mes,
    COALESCE(fb.valor_abono, 0)                                        AS valor,
    fb.prazo_ferias                                                    AS prazo_anexo,
    NULL::folha_origem                                                 AS origem,
    fb.conta_avulsa_id                                                 AS _conta_avulsa_id
  FROM ferias_pend_base fb
  WHERE fb.tipo IN ('abono_avulso', 'abono_combinado', 'abono_excepcional')
    AND COALESCE(fb.valor_abono, 0) > 0
),
decimo_pend AS (
  -- Stub: 13° aguardando financeiro — nenhuma linha por ora
  SELECT
    NULL::uuid                            AS tenant_id,
    NULL::uuid                            AS colaborador_id,
    'decimo_terceiro_p1'::nf_anexo_escopo AS escopo_tipo,
    NULL::uuid                            AS escopo_id,
    NULL::uuid                            AS linha_id,
    NULL::text                            AS label,
    NULL::int                             AS competencia_ano,
    NULL::int                             AS competencia_mes,
    NULL::numeric                         AS valor,
    NULL::date                            AS prazo_anexo,
    NULL::folha_origem                    AS origem,
    NULL::uuid                            AS _conta_avulsa_id
  WHERE false
),
uniao AS (
  SELECT * FROM folhas_pend
  UNION ALL SELECT * FROM ferias_pend
  UNION ALL SELECT * FROM decimo_pend
)
SELECT
  u.tenant_id,
  u.colaborador_id,
  u.escopo_tipo,
  u.escopo_id,
  u.linha_id,
  u.label,
  u.competencia_ano,
  u.competencia_mes,
  u.valor,
  u.prazo_anexo,
  -- NF
  (n.id IS NOT NULL)                                                   AS nf_anexada,
  n.id                                                                 AS nf_anexo_id,
  n.arquivo_nome                                                       AS nf_arquivo_nome,
  n.uploaded_at                                                        AS nf_uploaded_at,
  -- Dados do colaborador
  c.tipo_contratacao,
  c.funcao,
  -- origem: vem da folha para folha_mensal; null para férias (sem campo análogo)
  u.origem,
  -- alocacao_resumo: concatena empresas da folha quando escopo_tipo = folha_mensal
  -- Para férias: null (não há alocação por linha de férias)
  (
    SELECT string_agg(a.percentual::text || '%', ' / ' ORDER BY a.percentual DESC)
    FROM public.folhas_pagamento_alocacoes a
    WHERE a.folha_id = u.escopo_id
      AND u.escopo_tipo = 'folha_mensal'
  )                                                                    AS alocacao_resumo
FROM uniao u
LEFT JOIN public.contas_avulsas ca
  ON ca.id = u._conta_avulsa_id
LEFT JOIN public.colaboradores_nf_anexos n
  ON n.tenant_id      = u.tenant_id
 AND n.colaborador_id = u.colaborador_id
 AND n.escopo_tipo    = u.escopo_tipo
 AND n.escopo_id      = u.escopo_id
LEFT JOIN public.colaboradores c
  ON c.id = u.colaborador_id
WHERE ca.status IS DISTINCT FROM 'baixada';

GRANT SELECT ON public.vw_people_aprovar_financeiro TO authenticated;
