-- Vincula colaboradores.user_id aos profiles existentes para 71 colaboradores
-- ATIVOS do tenant Agencia California que ainda estavam com user_id NULL.
--
-- Criterio do match (sem ambiguidade - ja conferido no banco antes de rodar):
--   1. Tenant do colaborador = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c' (agencia-california).
--   2. colaboradores.user_id IS NULL (zero chance de sobrescrever um vinculo existente).
--   3. colaboradores.status = 'ativo'.
--   4. lower(trim(colaboradores.email)) = lower(trim(profiles.email)).
--   5. profiles.ativo = true E tenant_members.status = 'ativo' no mesmo tenant.
--
-- Garantias que tornam o update seguro:
--   - UNIQUE INDEX uniq_colaboradores_user_id (parcial WHERE user_id IS NOT NULL)
--     garante 1:1. Se algum par duplicar, a transacao faz ROLLBACK inteiro.
--   - FK colaboradores.user_id -> auth.users(id) ON DELETE SET NULL: sem cascata
--     destrutiva. Excluir um usuario futuramente apenas desvincula.
--   - Triggers de colaboradores (ferias, updated_at) nao reagem a user_id.
--   - Migration e idempotente: rodar de novo nao refaz nada (WHERE user_id IS NULL).
--
-- Os 7 colaboradores INATIVOS com user ainda ativo ficam de fora desta migration;
-- serao tratados caso a caso.

BEGIN;

WITH tenant AS (
  SELECT 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid AS id
),
alvos AS (
  SELECT c.id AS colab_id, p.id AS user_id
  FROM colaboradores c
  JOIN profiles p
    ON lower(trim(p.email)) = lower(trim(c.email))
  JOIN tenant_members tm
    ON tm.user_id = p.id
   AND tm.tenant_id = (SELECT id FROM tenant)
   AND tm.status = 'ativo'
  WHERE c.tenant_id = (SELECT id FROM tenant)
    AND c.user_id IS NULL
    AND c.status = 'ativo'
    AND p.ativo = true
)
UPDATE colaboradores c
SET user_id = a.user_id,
    updated_at = now()
FROM alvos a
WHERE c.id = a.colab_id
  AND c.user_id IS NULL;

-- Fail-fast: se o count nao bater com o esperado (71), o COMMIT nao acontece.
DO $$
DECLARE
  vinculados_agora int;
BEGIN
  SELECT COUNT(*) INTO vinculados_agora
  FROM colaboradores
  WHERE tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid
    AND user_id IS NOT NULL
    AND status = 'ativo';

  IF vinculados_agora < 77 THEN
    RAISE EXCEPTION 'Esperava pelo menos 77 colaboradores ativos vinculados (6 preexistentes + 71 novos), encontrei %', vinculados_agora;
  END IF;
END $$;

COMMIT;
