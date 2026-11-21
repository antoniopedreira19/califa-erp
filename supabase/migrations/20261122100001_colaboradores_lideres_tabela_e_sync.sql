-- Passo 1: suporte a N lideres por colaborador.
--
-- Modelo:
--   - Tabela nova `colaboradores_lideres (colaborador_id, lider_id, created_at)` com PK composta.
--   - Backfill a partir de `colaboradores.lider_id` atual (207 linhas esperadas).
--   - Trigger AFTER INSERT/DELETE mantem `colaboradores.lider_id` como cache
--     do "primeiro lider" (MIN(created_at)). Isso deixa codigo legado que le
--     `lider_id` continuar funcionando durante a transicao.
--   - Policies RLS do PR anterior reescritas pra olhar a tabela nova
--     (nao mais `colaboradores.lider_id`).
--   - View `vw_equipe_do_lider` reescrita pra EXISTS na tabela nova.
--
-- Spec: docs/superpowers/specs/2026-11-21-ferias-multiplos-lideres-design.md
BEGIN;

-- 1. Tabela
CREATE TABLE public.colaboradores_lideres (
  colaborador_id uuid NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  lider_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (colaborador_id, lider_id),
  CHECK (colaborador_id <> lider_id::uuid)
);

CREATE INDEX idx_colaboradores_lideres_lider_id
  ON public.colaboradores_lideres (lider_id);

COMMENT ON TABLE public.colaboradores_lideres IS
  'Vinculos colaborador<->lider (N:N). Qualquer um dos lideres pode aprovar/reprovar ferias do colaborador. `colaboradores.lider_id` fica como cache do primeiro (MIN created_at) por retrocompat. Spec 21/11/2026.';

ALTER TABLE public.colaboradores_lideres ENABLE ROW LEVEL SECURITY;

-- 2. Backfill a partir do cadastro atual
INSERT INTO public.colaboradores_lideres (colaborador_id, lider_id)
SELECT id, lider_id
  FROM public.colaboradores
 WHERE lider_id IS NOT NULL;

-- 3. Trigger de sincronia (mantem colaboradores.lider_id = primeiro lider)
CREATE OR REPLACE FUNCTION public.fn_sync_colaborador_lider_cache()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  alvo uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    alvo := NEW.colaborador_id;
  ELSE
    alvo := OLD.colaborador_id;
  END IF;

  UPDATE public.colaboradores
     SET lider_id = (
       SELECT lider_id
         FROM public.colaboradores_lideres
        WHERE colaborador_id = alvo
        ORDER BY created_at, lider_id
        LIMIT 1
     )
   WHERE id = alvo;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_colaborador_lider_cache
AFTER INSERT OR DELETE ON public.colaboradores_lideres
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_colaborador_lider_cache();

-- 4. Policies na tabela nova
--    admin/rh: pleno (SELECT + INSERT + DELETE)
--    colaborador: ve os vinculos onde ele e o colaborador
--    lider: ve os vinculos onde ele e o lider
CREATE POLICY colab_lideres_admin_rh ON public.colaboradores_lideres
  FOR ALL TO authenticated
  USING (
    is_tenant_admin((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id))
    OR is_tenant_rh((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id))
  )
  WITH CHECK (
    is_tenant_admin((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id))
    OR is_tenant_rh((SELECT tenant_id FROM public.colaboradores WHERE id = colaborador_id))
  );

CREATE POLICY colab_lideres_select_proprio ON public.colaboradores_lideres
  FOR SELECT TO authenticated
  USING (
    is_colaborador_proprio(colaborador_id)
    OR lider_id = (SELECT auth.uid())
  );

GRANT SELECT, INSERT, DELETE ON public.colaboradores_lideres TO authenticated;

-- 5. Reescreve policies RLS do PR anterior pra olhar a tabela nova.
--    O PR 1 (fundacao) criou `ferias_lancamentos_lider_select` e
--    `ferias_periodos_lider_select` olhando `colaboradores.lider_id` direto.
--    O fix do PR 2 criou `ferias_lancamentos_lider_update` idem.
--    Agora todas tres passam a olhar `colaboradores_lideres` por EXISTS.

DROP POLICY IF EXISTS ferias_lancamentos_lider_select ON public.colaboradores_ferias_lancamentos;
CREATE POLICY ferias_lancamentos_lider_select
  ON public.colaboradores_ferias_lancamentos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores_lideres cl
       WHERE cl.colaborador_id = colaboradores_ferias_lancamentos.colaborador_id
         AND cl.lider_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS ferias_periodos_lider_select ON public.colaboradores_ferias_periodos;
CREATE POLICY ferias_periodos_lider_select
  ON public.colaboradores_ferias_periodos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores_lideres cl
       WHERE cl.colaborador_id = colaboradores_ferias_periodos.colaborador_id
         AND cl.lider_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS ferias_lancamentos_lider_update ON public.colaboradores_ferias_lancamentos;
CREATE POLICY ferias_lancamentos_lider_update
  ON public.colaboradores_ferias_lancamentos
  FOR UPDATE TO authenticated
  USING (
    status = 'aguardando_gestor'
    AND EXISTS (
      SELECT 1 FROM public.colaboradores_lideres cl
       WHERE cl.colaborador_id = colaboradores_ferias_lancamentos.colaborador_id
         AND cl.lider_id = (SELECT auth.uid())
    )
  );

-- 6. Reescreve a view `vw_equipe_do_lider` pra usar a tabela nova.
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
WHERE EXISTS (
  SELECT 1 FROM public.colaboradores_lideres cl
   WHERE cl.colaborador_id = c.id
     AND cl.lider_id = (SELECT auth.uid())
);

COMMENT ON VIEW public.vw_equipe_do_lider IS
  'View nao-PII dos colaboradores pra tab Equipe do lider. Gating EMBUTIDO via EXISTS em colaboradores_lideres. Qualquer um dos N lideres ve o colaborador.';

COMMIT;
