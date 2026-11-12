-- Inativa 6 users do tenant Agencia California cujo colaborador vinculado ja
-- esta inativo e cujo uso do sistema e nulo ou residual.
--
-- Criterio de escolha (apurado no banco antes de rodar):
--   - 5 sem nenhuma atividade relevante no sistema (0 audits ou 1 audit unico).
--   - 1 com ultima atividade em 07/10/2026 (sem acao ha ~5 semanas); deixa 2
--     pendencias administrativas nao bloqueantes (1 job aberto como GP e 1
--     projeto como responsavel): o nome segue aparecendo porque
--     equipe-do-projeto.ts le profiles sem filtro de ativo; precisa de
--     designacao manual depois.
--
-- Nao entra nesta migration: 1 usuario com colaborador inativo mas operacao
-- ativa (201 audits, 33 PPs tocadas, 6 jobs como produtora; ultima acao 6 dias
-- atras) - investigar separadamente se o colaborador foi inativado por engano.
--
-- Padrao: segue exatamente o alterarStatusMembership() de
-- app/(app)/admin/usuarios/actions.ts:785. Alteramos APENAS tenant_members.status.
-- NAO mexemos em profiles.ativo (escopo global, nao especifico do tenant).
--
-- Efeito pratico:
--   - Login da pessoa volta a ser aceito, mas get_session_context retorna
--     'sem_tenant' e o usuario e redirecionado antes de acessar qualquer dado.
--   - Todo historico (jobs, orcamentos, PPs, auditoria, mensagens) intacto.
--   - Nome da pessoa continua aparecendo nas telas de equipe e historico.
--   - Reversivel: basta setar status='ativo' de novo.

BEGIN;

WITH alvos AS (
  SELECT unnest(ARRAY[
    'd5d6165a-bf3a-46f4-a223-caf87730f31a'::uuid,
    'd2c32a81-2b53-4baf-885a-a46be185014d'::uuid,
    'ab6a3c88-7588-4821-a157-95ea1694c527'::uuid,
    '11d92b9d-c163-4d7a-ad3b-5006d6687ccc'::uuid,
    '136f2389-6ca6-4be8-a5db-bf27bafa9c3b'::uuid,
    'ebdf0fa6-98b4-43ad-8881-d32a7703942e'::uuid
  ]) AS user_id
)
UPDATE tenant_members tm
SET status = 'inativo',
    updated_at = now()
FROM alvos a
WHERE tm.user_id = a.user_id
  AND tm.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid
  AND tm.status = 'ativo';

-- Auditoria: uma linha por usuario inativado. actor_user_id=NULL pois a acao
-- vem da migration (sem sessao de usuario). FK permite NULL (ON DELETE SET NULL).
WITH alvos AS (
  SELECT unnest(ARRAY[
    'd5d6165a-bf3a-46f4-a223-caf87730f31a'::uuid,
    'd2c32a81-2b53-4baf-885a-a46be185014d'::uuid,
    'ab6a3c88-7588-4821-a157-95ea1694c527'::uuid,
    '11d92b9d-c163-4d7a-ad3b-5006d6687ccc'::uuid,
    '136f2389-6ca6-4be8-a5db-bf27bafa9c3b'::uuid,
    'ebdf0fa6-98b4-43ad-8881-d32a7703942e'::uuid
  ]) AS user_id
)
INSERT INTO audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
SELECT
  'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid,
  NULL,
  'tenant_member.status_alterado',
  'tenant_member',
  a.user_id,
  jsonb_build_object(
    'de', 'ativo',
    'para', 'inativo',
    'origem', 'migration_20261112500001',
    'motivo', 'colaborador vinculado inativo e uso nulo ou residual'
  )
FROM alvos a;

-- Fail-fast: confirmar exatamente 6 linhas inativadas agora.
DO $$
DECLARE
  inativados_total int;
BEGIN
  SELECT COUNT(*) INTO inativados_total
  FROM tenant_members
  WHERE tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid
    AND status = 'inativo'
    AND user_id IN (
      'd5d6165a-bf3a-46f4-a223-caf87730f31a',
      'd2c32a81-2b53-4baf-885a-a46be185014d',
      'ab6a3c88-7588-4821-a157-95ea1694c527',
      '11d92b9d-c163-4d7a-ad3b-5006d6687ccc',
      '136f2389-6ca6-4be8-a5db-bf27bafa9c3b',
      'ebdf0fa6-98b4-43ad-8881-d32a7703942e'
    );

  IF inativados_total <> 6 THEN
    RAISE EXCEPTION 'Esperava 6 tenant_members inativos apos a migration, encontrei %', inativados_total;
  END IF;
END $$;

COMMIT;
