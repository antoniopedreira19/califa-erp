-- Enum folha_origem — discrimina qual fluxo criou a linha de folha.
-- 'california' = gerada por gerarFolha a partir do cadastro.
-- 'contabilidade' = importada do PDF "Relação Geral dos Líquidos".
-- Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D1)

CREATE TYPE public.folha_origem AS ENUM ('california', 'contabilidade');
