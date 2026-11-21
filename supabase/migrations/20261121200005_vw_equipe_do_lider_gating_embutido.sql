-- FIX de seguranca no vw_equipe_do_lider (criada em 20261121200004).
--
-- Problema detectado no self-review do PR 1:
--   A view default-mode (security_invoker = off no PG 15+) roda com os
--   privilegios do owner (postgres), bypassando o RLS de colaboradores.
--   Como o grant SELECT estava pra 'authenticated' e NAO havia WHERE
--   filtrando pelo caller, qualquer usuario autenticado podia enxergar
--   todo o cadastro de colaboradores (sem salario/CPF, mas com nome,
--   alocacao e email corporativo).
--
-- Fix: filtro embutido no WHERE da view. Agora o SELECT so retorna os
-- colaboradores cujo lider_id = auth.uid() do caller. Admin/RH que
-- quiserem ver equipe de outro lider continuam podendo ler a tabela
-- colaboradores direto via policies existentes.
--
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
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
LEFT JOIN public.profiles p  ON p.id = c.user_id
WHERE c.lider_id = (select auth.uid());

COMMENT ON VIEW public.vw_equipe_do_lider IS
  'View nao-PII dos colaboradores pra tab Equipe do lider. SEM salario, CPF, telefone, endereco, data_nascimento. Gating EMBUTIDO: so retorna linhas onde lider_id = auth.uid() do caller. Admin/RH que precisem de equipe de outro lider leem colaboradores direto.';

COMMIT;
