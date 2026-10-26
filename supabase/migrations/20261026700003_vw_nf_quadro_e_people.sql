-- Migration: 20261026700003_vw_nf_quadro_e_people.sql
-- Views que unificam folhas mensais + lançamentos de férias + parcelas de 13°
-- numa lista de "NFs esperadas". vw_nf_pendentes_colaborador alimenta o quadro
-- no perfil; vw_people_aprovar_financeiro alimenta a aba People do financeiro.
-- Ambas respeitam cutoff 2026-10 (competência >= 202610) e filtram linhas já
-- pagas via folhas_pagamento.status='paga' (folha) ou contas_avulsas.status='baixada' (férias).
--
-- Antes de criar as views, adiciona 2 policies SELECT aditivas:
--   - ferias_lancamentos_financeiro_select: financeiro lê lançamentos em
--     aguardando_financeiro ou aprovado (para participar da view com security_invoker)
--   - decimo_terceiro_linhas_financeiro_select: financeiro lê linhas de 13°
--     (stub; fluxo de pagamento virá em task futura)
-- Essas policies são ADITIVAS — admin/rh continuam cobrindo tudo pelas policies existentes.
--
-- Decisões de modelagem:
--  - folhas_pagamento não tem conta_avulsa_id; o vínculo é o oposto:
--    contas_avulsas.folha_id → folhas_pagamento.id. Portanto o filtro de
--    "já paga" em folhas usa f.status = 'paga' diretamente (mais simples e correto).
--  - conta_avulsa_status tem 'aprovada' e 'baixada' (não 'paga'). Para férias,
--    "já paga" = contas_avulsas.status = 'baixada'.
--  - abono_combinado gera 2 linhas via UNION ALL interno na CTE ferias.
--  - decimo CTE é stub com SELECT ... WHERE false (estrutura correta para UNION ALL).
--  - folhas_pagamento_alocacoes une via folha_id, não colaborador_id direto.
--  - security_invoker = on: a view respeita as RLS do caller, não do definer.

-- ============================================================
-- 1. POLICIES ADITIVAS PARA O FINANCEIRO
-- ============================================================

-- Financeiro vê lançamentos de férias que estão aguardando sua aprovação ou já aprovados
DROP POLICY IF EXISTS ferias_lancamentos_financeiro_select
  ON public.colaboradores_ferias_lancamentos;
CREATE POLICY ferias_lancamentos_financeiro_select
  ON public.colaboradores_ferias_lancamentos
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_financeiro(tenant_id)
    AND status IN ('aguardando_financeiro', 'aprovado')
  );

-- Financeiro vê linhas de 13° (fluxo de aprovação virá em task futura; stub por ora)
DROP POLICY IF EXISTS decimo_terceiro_linhas_financeiro_select
  ON public.decimo_terceiro_linhas;
CREATE POLICY decimo_terceiro_linhas_financeiro_select
  ON public.decimo_terceiro_linhas
  FOR SELECT TO authenticated
  USING (public.is_tenant_financeiro(tenant_id));

-- ============================================================
-- 2. VIEW: vw_nf_pendentes_colaborador
--    Consultada pelo quadro no perfil do colaborador.
--    RLS: security_invoker=on → colaborador só vê o próprio (policy existente
--    em folhas_pagamento não cobre colaborador; mas colaboradores_nf_anexos
--    já aplica is_tenant_member; o quadro é acessado via server component
--    autenticado que filtra por colaborador_id).
-- ============================================================

DROP VIEW IF EXISTS public.vw_nf_pendentes_colaborador;

CREATE VIEW public.vw_nf_pendentes_colaborador
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
    -- prazo: dia 3 do próprio mês de competência (regra existente)
    make_date(f.competencia_ano::int, f.competencia_mes::int, 3)       AS prazo_anexo,
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
-- 3. VIEW: vw_people_aprovar_financeiro
--    Consultada pela aba People em /financeiro/contas-a-pagar.
--    Filtra apenas linhas AGUARDANDO ação do financeiro:
--      - folha_mensal: status = 'enviada'
--      - ferias_usufruto / ferias_abono: status = 'aguardando_financeiro'
--    Adiciona colunas extras: linha_id, tipo_contratacao, funcao, origem,
--    alocacao_resumo (percentual × empresa das alocações da folha).
-- ============================================================

DROP VIEW IF EXISTS public.vw_people_aprovar_financeiro;

CREATE VIEW public.vw_people_aprovar_financeiro
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
    make_date(f.competencia_ano::int, f.competencia_mes::int, 3)       AS prazo_anexo,
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
