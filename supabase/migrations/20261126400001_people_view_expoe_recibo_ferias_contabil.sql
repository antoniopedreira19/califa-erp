-- Expoe o recibo da contabilidade das férias (folhas_pagamento.anexo_url) para
-- o drawer de revisão do financeiro em /financeiro/contas-a-pagar.
--
-- Contexto: na aba People, a linha de férias CLT (origem=contabilidade) tem o
-- recibo gravado em `folhas_pagamento.anexo_url` (bucket `recibos-ferias`),
-- NÃO em `colaboradores_nf_anexos`. A view atual só olha pra tabela de NF
-- anexos — o resultado é que o drawer do financeiro trata a linha como
-- "não exige NF nem recibo (CLT importada da contabilidade)" e o botão de
-- aprovar paga sem o financeiro ver o recibo em cima dele.
--
-- Esta migration:
--   1. Adiciona `folha_anexo_url` ao SELECT final da view
--      `vw_people_aprovar_financeiro`. O drawer usa esse campo (quando
--      presente) pra montar o painel esquerdo do iframe no fluxo CLT férias.
--   2. Adiciona policy de SELECT no bucket `recibos-ferias` pra `financeiro`
--      (administrador e rh já têm via `ferias_recibo_rh_admin_all`).
--
-- Mudança aditiva (coluna nova + policy nova). Não altera semântica das
-- colunas existentes (`nf_anexada`, `nf_anexo_id`, etc.) — quem consome a
-- view hoje continua lendo exatamente o que lia.

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
    CASE f.tipo
      WHEN 'salario' THEN
        (make_date(f.competencia_ano::int, f.competencia_mes::int, 1) + INTERVAL '1 month 2 days')::date
      WHEN 'ferias' THEN
        (fl.data_inicio - INTERVAL '2 days')::date
      ELSE NULL::date
    END                                                                    AS prazo_anexo,
    f.tipo_folha_ferias                                                    AS tipo_folha_ferias,
    f.origem                                                               AS origem,
    f.anexo_url                                                            AS folha_anexo_url
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
  tf.tipo_folha_ferias,
  tf.folha_anexo_url
FROM todas_folhas_pend tf
LEFT JOIN public.colaboradores_nf_anexos n
  ON n.tenant_id      = tf.tenant_id
 AND n.colaborador_id = tf.colaborador_id
 AND n.escopo_tipo    = tf.escopo_tipo
 AND n.escopo_id      = tf.escopo_id
LEFT JOIN public.colaboradores c
  ON c.id = tf.colaborador_id;

GRANT SELECT ON public.vw_people_aprovar_financeiro TO authenticated;

COMMENT ON VIEW public.vw_people_aprovar_financeiro IS
  'Linhas de folha (salário/férias/13°) aguardando aprovação do financeiro, com nf_anexada (nf/recibo em colaboradores_nf_anexos) + folha_anexo_url (recibo da contabilidade de férias CLT, em folhas_pagamento.anexo_url).';

-- Permite o financeiro baixar o recibo da contabilidade de férias CLT.
-- `administrador` e `rh` já têm SELECT via policy `ferias_recibo_rh_admin_all`.
DROP POLICY IF EXISTS ferias_recibo_financeiro_read ON storage.objects;
CREATE POLICY ferias_recibo_financeiro_read ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'recibos-ferias'
  AND EXISTS (
    SELECT 1
    FROM tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid())
      AND tm.status = 'ativo'
      AND tm.role = 'financeiro'
  )
);
