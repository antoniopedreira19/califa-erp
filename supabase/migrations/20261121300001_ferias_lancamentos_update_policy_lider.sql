-- FIX de self-review do PR 2.
--
-- Problema detectado: a policy `ferias_lancamentos_update` so libera
-- UPDATE pra admin, rh e o proprio colaborador. O lider direto nao esta
-- coberto, entao as actions `aprovarLancamentoComoLider` e
-- `reprovarLancamentoComoLider` executavam UPDATE que o Supabase
-- retornava como "ok" (sem erro) mas que NAO atualizava linha nenhuma —
-- falha silenciosa.
--
-- Fix: policy nova que permite UPDATE quando o caller e o lider direto
-- do colaborador e o status atual e `aguardando_gestor` (a transicao
-- autorizada pela etapa 1 do fluxo). A policy nao restringe colunas —
-- o guard de campo fica na app layer, igual as policies existentes.
--
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
BEGIN;

CREATE POLICY ferias_lancamentos_lider_update
  ON public.colaboradores_ferias_lancamentos
  FOR UPDATE
  TO authenticated
  USING (
    status = 'aguardando_gestor'
    AND EXISTS (
      SELECT 1
      FROM public.colaboradores c
      WHERE c.id = colaboradores_ferias_lancamentos.colaborador_id
        AND c.lider_id = (select auth.uid())
    )
  );

COMMIT;
