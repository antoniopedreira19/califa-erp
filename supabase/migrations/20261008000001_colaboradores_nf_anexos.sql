-- Anexo de NF por (colaborador, competência). Desacoplado de folhas_pagamento
-- de propósito: colaborador pode anexar antes do RH gerar a folha PJ, e a NF
-- persiste se a folha for regenerada.
-- Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D1)

CREATE TABLE public.colaboradores_nf_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  colaborador_id uuid NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  competencia_ano int NOT NULL,
  competencia_mes int NOT NULL CHECK (competencia_mes BETWEEN 1 AND 12),
  arquivo_path text NOT NULL,
  arquivo_nome text NOT NULL,
  arquivo_tamanho_bytes int NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX colaboradores_nf_anexos_competencia_idx
  ON public.colaboradores_nf_anexos (tenant_id, colaborador_id, competencia_ano, competencia_mes);

CREATE INDEX colaboradores_nf_anexos_colab_idx
  ON public.colaboradores_nf_anexos (colaborador_id);

ALTER TABLE public.colaboradores_nf_anexos ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro do tenant (RH, financeiro, próprio colab). Diferenciação
-- dono vs não-dono fica na server action (permissoes.ts).
CREATE POLICY nf_anexos_select ON public.colaboradores_nf_anexos
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_insert ON public.colaboradores_nf_anexos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_update ON public.colaboradores_nf_anexos
  FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_delete ON public.colaboradores_nf_anexos
  FOR DELETE TO authenticated
  USING (public.is_tenant_member(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colaboradores_nf_anexos TO authenticated;
