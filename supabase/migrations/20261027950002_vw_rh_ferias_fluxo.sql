-- View agregada do kanban de fluxo em /rh/ferias. Linha = lançamento (não folha).
-- Agrega folhas de pagamento associadas + status de NF do colab (via
-- colaboradores_nf_anexos) pra permitir visualizar progresso de documentos.
-- Spec: docs/superpowers/specs/2026-10-27-rh-ferias-kanban-fluxo-design.md

CREATE OR REPLACE VIEW public.vw_rh_ferias_fluxo
WITH (security_invoker = on) AS
SELECT
  l.id AS lancamento_id,
  l.tenant_id,
  l.colaborador_id,
  c.nome AS colaborador_nome,
  c.tipo_contratacao,
  l.tipo AS tipo_lancamento,
  l.data_inicio,
  l.data_fim,
  l.dias,
  l.dias_abono,
  l.status AS status_lancamento,
  l.created_at,
  l.aprovado_em,
  l.motivo_reprovacao,
  l.observacao,
  count(f.id) FILTER (WHERE f.id IS NOT NULL) AS folhas_total,
  count(f.id) FILTER (
    WHERE f.origem = 'contabilidade' AND f.anexo_url IS NOT NULL
  ) AS folhas_clt_com_recibo,
  count(f.id) FILTER (WHERE f.origem = 'contabilidade') AS folhas_clt_total,
  count(f.id) FILTER (WHERE f.origem = 'california') AS folhas_pj_total,
  count(f.id) FILTER (
    WHERE f.origem = 'california'
      AND EXISTS (
        SELECT 1 FROM public.colaboradores_nf_anexos n
        WHERE n.colaborador_id = l.colaborador_id
          AND n.escopo_id = l.id
          AND n.escopo_tipo = CASE
            WHEN f.tipo_folha_ferias = 'usufruto' THEN 'ferias_usufruto'::public.nf_anexo_escopo
            WHEN f.tipo_folha_ferias = 'abono'    THEN 'ferias_abono'::public.nf_anexo_escopo
          END
      )
  ) AS folhas_pj_com_nf,
  count(f.id) FILTER (WHERE f.status = 'paga') AS folhas_pagas,
  min(f.data_pagamento_prevista) AS vencimento_mais_proximo,
  bool_and(f.status = 'paga') FILTER (WHERE f.id IS NOT NULL) AS todas_pagas,
  bool_and(f.status IN ('enviada','aprovada','paga','pendente_correcao'))
    FILTER (WHERE f.id IS NOT NULL) AS todas_enviadas
FROM public.colaboradores_ferias_lancamentos l
JOIN public.colaboradores c ON c.id = l.colaborador_id
LEFT JOIN public.folhas_pagamento f
  ON f.lancamento_ferias_id = l.id AND f.tipo = 'ferias'
GROUP BY l.id, c.id;

GRANT SELECT ON public.vw_rh_ferias_fluxo TO authenticated;
