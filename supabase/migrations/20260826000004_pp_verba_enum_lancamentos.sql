-- =====================================================================
-- Enum origem_lancamento ganha os valores da devolução de verba.
-- Migration separada porque ADD VALUE precisa commit antes de ser usado
-- em constraints (padrão de 20260820000007_desembolso_enum_lancamentos).
-- =====================================================================

alter type origem_lancamento add value if not exists 'pp_devolucao_verba';
alter type origem_lancamento add value if not exists 'pp_devolucao_verba_estornada';
