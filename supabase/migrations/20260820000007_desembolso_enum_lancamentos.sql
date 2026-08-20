-- =====================================================================
-- Novos valores no enum origem_lancamento para desembolsos.
-- Migration separada porque ADD VALUE precisa commit antes de ser usado
-- em constraints (padrão já documentado em 20260813000012).
-- =====================================================================

alter type origem_lancamento add value if not exists 'desembolso_baixa';
alter type origem_lancamento add value if not exists 'desembolso_baixa_estornada';
alter type origem_lancamento add value if not exists 'desembolso_estorno';
