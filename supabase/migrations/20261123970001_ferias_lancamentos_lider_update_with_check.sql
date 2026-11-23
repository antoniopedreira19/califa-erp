-- FIX de regressao do PR 2 (fluxo lider->RH, 21/11), complemento ao
-- 20261123960001_ferias_lancamentos_insert_aceita_aguardando_gestor.sql.
--
-- Problema: `ferias_lancamentos_lider_update` libera a leitura da linha
-- (USING) quando `status = 'aguardando_gestor'` e o caller e lider. Mas
-- nao tem WITH CHECK proprio — e, para UPDATE, o Postgres reaproveita
-- o USING como WITH CHECK quando o segundo e NULL. Resultado: a linha
-- APOS o UPDATE tambem precisaria ter `status = 'aguardando_gestor'`,
-- mas o action de aprovar troca pra `pendente_aprovacao` (e o de reprovar
-- pra `reprovado`) — entao o UPDATE caia em "new row violates row-level
-- security policy" pra qualquer lider tentando aprovar ou reprovar.
--
-- Fix: recriar a policy com WITH CHECK explicito, permitindo exatamente
-- as duas transicoes do lider (aguardando_gestor -> pendente_aprovacao
-- ou -> reprovado), carimbando o aprovador em `aprovado_pelo_lider_por`
-- e exigindo que o vinculo lider-colaborador siga valendo.
BEGIN;

DROP POLICY IF EXISTS ferias_lancamentos_lider_update
  ON public.colaboradores_ferias_lancamentos;

CREATE POLICY ferias_lancamentos_lider_update
  ON public.colaboradores_ferias_lancamentos
  FOR UPDATE
  TO authenticated
  USING (
    status = 'aguardando_gestor'
    AND EXISTS (
      SELECT 1
      FROM public.colaboradores_lideres cl
      WHERE cl.colaborador_id = colaboradores_ferias_lancamentos.colaborador_id
        AND cl.lider_id = (select auth.uid())
    )
  )
  WITH CHECK (
    status IN ('pendente_aprovacao', 'reprovado')
    AND aprovado_pelo_lider_por = (select auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.colaboradores_lideres cl
      WHERE cl.colaborador_id = colaboradores_ferias_lancamentos.colaborador_id
        AND cl.lider_id = (select auth.uid())
    )
  );

COMMIT;
