-- Colunas de rastro da aprovacao pelo lider direto (fase 1 do fluxo lider -> RH).
-- Todas nullable (sem valor pros lancamentos antigos). aprovacao_lider_override
-- tem default false pra simplificar leituras ("ninguem fez override ainda").
-- motivo_override_lider e nullable: a UI do RH nao exige motivo (decisao 21/11).
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
BEGIN;

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD COLUMN aprovado_pelo_lider_por uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN aprovado_pelo_lider_em  timestamptz,
  ADD COLUMN aprovacao_lider_override boolean NOT NULL DEFAULT false,
  ADD COLUMN motivo_override_lider   text;

COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.aprovado_pelo_lider_por
  IS 'Profile do lider direto que aprovou a solicitacao antes do RH. NULL em lancamentos legados ou em lancar-direto do RH.';
COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.aprovado_pelo_lider_em
  IS 'Quando o lider aprovou. Junto com aprovado_pelo_lider_por da a trilha da etapa do lider.';
COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.aprovacao_lider_override
  IS 'True quando o RH aprovou no lugar do lider (override). Mutuamente exclusivo com aprovado_pelo_lider_por preenchido.';
COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.motivo_override_lider
  IS 'Motivo opcional do override do RH. Nullable; a UI nao exige.';

-- Indice parcial pra a Equipe do lider: ranking de pendentes.
CREATE INDEX IF NOT EXISTS idx_ferias_lanc_aguardando_gestor
  ON public.colaboradores_ferias_lancamentos (colaborador_id)
  WHERE status = 'aguardando_gestor';

COMMIT;
