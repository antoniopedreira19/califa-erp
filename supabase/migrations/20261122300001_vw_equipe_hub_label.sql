-- Troca o label "Múltiplas" por "Hub" na `vw_equipe_do_lider`.
--
-- A coluna de alocação na tab Equipe do líder mostrava "Múltiplas" quando
-- o colaborador tinha mais de uma empresa ou mais de uma regional vigente.
-- O termo "Hub" já é a convenção local (rateio padrão da empresa quando
-- `usa_rateio_empresa = true`) e fica mais claro na UI.
--
-- Nenhuma outra mudança — só o label.
BEGIN;

CREATE OR REPLACE VIEW public.vw_equipe_do_lider AS
WITH alocacao_resumo AS (
  SELECT
    ca.colaborador_id,
    CASE WHEN COUNT(DISTINCT e.id) = 1 THEN MAX(e.nome_fantasia) ELSE 'Hub' END AS alocacao_empresa,
    CASE WHEN COUNT(DISTINCT r.id) = 1 THEN MAX(r.nome) ELSE 'Hub' END AS alocacao_regional
  FROM public.colaboradores_alocacoes ca
  JOIN public.empresas e   ON e.id = ca.empresa_id
  LEFT JOIN public.regionais r ON r.id = ca.regional_id
  WHERE ca.data_fim IS NULL
  GROUP BY ca.colaborador_id
)
SELECT
  c.id                                           AS colaborador_id,
  c.tenant_id,
  c.nome,
  c.tipo_contratacao,
  ar.alocacao_empresa,
  ar.alocacao_regional,
  CASE
    WHEN p.email ILIKE '%@agenciacalifornia.com.br' THEN p.email
    WHEN c.email ILIKE '%@agenciacalifornia.com.br' THEN c.email
    ELSE NULL
  END                                            AS email_corporativo,
  c.lider_id
FROM public.colaboradores c
LEFT JOIN alocacao_resumo ar ON ar.colaborador_id = c.id
LEFT JOIN public.profiles p  ON p.id = c.user_id
WHERE EXISTS (
  SELECT 1 FROM public.colaboradores_lideres cl
   WHERE cl.colaborador_id = c.id
     AND cl.lider_id = (SELECT auth.uid())
);

COMMIT;
