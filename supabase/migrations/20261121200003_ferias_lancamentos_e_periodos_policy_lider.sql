-- Policies RLS pra permitir que o LIDER DIRETO leia os lancamentos
-- e periodos de ferias de quem ele lidera. Nao concede escrita.
-- As policies existentes (admin, rh, proprio colaborador) seguem vigentes;
-- essa aqui soma, nao substitui.
--
-- Caso de borda coberto: se o profile do lider foi desligado (nao ha
-- vinculo ativo em tenant_members), auth.uid() ainda e dele ate o logout
-- - mas no proximo login a sessao nao abre, e EXISTS retorna FALSE porque
-- is_tenant_member no fluxo de login nao autoriza. A policy aqui filtra
-- pelo lider_id apontando pra ele, nao pelo vinculo: se o cadastro ainda
-- aponta, ele ve. Cabe ao RH limpar lider_id dos desligados.
--
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
BEGIN;

CREATE POLICY ferias_lancamentos_lider_select
  ON public.colaboradores_ferias_lancamentos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.colaboradores c
      WHERE c.id = colaboradores_ferias_lancamentos.colaborador_id
        AND c.lider_id = (select auth.uid())
    )
  );

CREATE POLICY ferias_periodos_lider_select
  ON public.colaboradores_ferias_periodos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.colaboradores c
      WHERE c.id = colaboradores_ferias_periodos.colaborador_id
        AND c.lider_id = (select auth.uid())
    )
  );

COMMIT;
