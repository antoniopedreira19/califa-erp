-- FIX de regressao do PR 2 (fluxo lider->RH, 21/11).
--
-- Problema: `solicitarFerias` agora chama `decidirStatusInicialSolicitacao`,
-- que retorna `aguardando_gestor` quando o colaborador tem lider_id. Mas a
-- policy `ferias_lancamentos_insert` continuou travada em
-- `status = 'pendente_aprovacao'`, entao qualquer solicitacao nova de um
-- colaborador com lider bate em "new row violates row-level security policy".
--
-- As 6 solicitacoes antigas do backfill (20261121400001) nao exercitaram
-- o INSERT policy — vieram de UPDATE. O primeiro colaborador com lider a
-- tentar solicitar via UI caiu na trava em 23/11.
--
-- Fix: dropar e recriar `ferias_lancamentos_insert` aceitando tanto
-- `pendente_aprovacao` (sem lider) quanto `aguardando_gestor` (com lider).
-- As outras travas seguem: is_colaborador_proprio, lancado_direto_por_rh = false,
-- solicitado_por = auth.uid(). RH/admin continuam podendo lancar em qualquer
-- status via ramo `is_tenant_admin OR is_tenant_rh`.
BEGIN;

DROP POLICY IF EXISTS ferias_lancamentos_insert
  ON public.colaboradores_ferias_lancamentos;

CREATE POLICY ferias_lancamentos_insert
  ON public.colaboradores_ferias_lancamentos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_tenant_admin(tenant_id)
    OR is_tenant_rh(tenant_id)
    OR (
      is_colaborador_proprio(colaborador_id)
      AND status IN ('pendente_aprovacao', 'aguardando_gestor')
      AND lancado_direto_por_rh = false
      AND solicitado_por = (select auth.uid())
    )
  );

COMMIT;
