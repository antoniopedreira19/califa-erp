-- Auditoria das importações do PDF da contabilidade (fluxo CLT).
-- Idempotência por (competencia, hash do arquivo).
-- Guarda totalizadores do PDF para conferência futura.
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (Task 4 do spec)

CREATE TABLE public.folha_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  competencia_ano int NOT NULL,
  competencia_mes int NOT NULL,
  arquivo_nome text NOT NULL,
  arquivo_hash text NOT NULL,
  linhas_total int NOT NULL DEFAULT 0,
  linhas_criadas int NOT NULL DEFAULT 0,
  linhas_atualizadas int NOT NULL DEFAULT 0,
  linhas_ignoradas int NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  totalizadores_pdf jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.folha_importacoes IS
  'Histórico de importação do PDF Relação Geral dos Líquidos. Idempotência por (competencia, hash do arquivo).';

CREATE UNIQUE INDEX folha_importacoes_hash_competencia_idx
  ON public.folha_importacoes (tenant_id, competencia_ano, competencia_mes, arquivo_hash);

CREATE INDEX folha_importacoes_competencia_idx
  ON public.folha_importacoes (tenant_id, competencia_ano, competencia_mes);

ALTER TABLE public.folha_importacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY folha_importacoes_select ON public.folha_importacoes
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY folha_importacoes_insert ON public.folha_importacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    AND uploaded_by = (SELECT auth.uid())
  );

GRANT SELECT, INSERT ON public.folha_importacoes TO authenticated;
