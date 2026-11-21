-- View para a tab Equipe do lider: espelha colaboradores sem expor PII
-- sensivel (salario, CPF, data_nascimento, telefone, endereco).
-- A alocacao vem denormalizada: se o colab tem 1 alocacao vigente,
-- mostra nome da empresa/regional; se tem N, mostra 'Multiplas'.
-- O email corporativo vem do profile quando existe (via user_id), senao
-- do colaborador; so e exposto se termina em @agenciacalifornia.com.br.
--
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
-- Nota: colaboradores.user_id (nao profile_id) e o link com profiles.id.
BEGIN;

CREATE OR REPLACE VIEW public.vw_equipe_do_lider AS
WITH alocacao_resumo AS (
  SELECT
    ca.colaborador_id,
    CASE WHEN COUNT(DISTINCT e.id) = 1 THEN MAX(e.nome_fantasia) ELSE 'Múltiplas' END AS alocacao_empresa,
    CASE WHEN COUNT(DISTINCT r.id) = 1 THEN MAX(r.nome) ELSE 'Múltiplas' END AS alocacao_regional
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
LEFT JOIN public.profiles p  ON p.id = c.user_id;

COMMENT ON VIEW public.vw_equipe_do_lider IS
  'View nao-PII dos colaboradores pra tab Equipe do lider. SEM salario, CPF, telefone, endereco, data_nascimento. Filtragem por lider acontece no WHERE do consumidor.';

GRANT SELECT ON public.vw_equipe_do_lider TO authenticated;

COMMIT;
