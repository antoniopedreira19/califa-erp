-- Adiciona status 'aguardando_gestor' ao enum ferias_lancamento_status.
-- Entra antes de 'pendente_aprovacao' na ordem do enum (sortorder < 1).
-- Fundacao pro fluxo de aprovacao em duas etapas (lider -> RH).
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
ALTER TYPE public.ferias_lancamento_status
  ADD VALUE IF NOT EXISTS 'aguardando_gestor' BEFORE 'pendente_aprovacao';
