-- =====================================================================
-- Estende lancamentos_financeiros para receber baixa de titulo.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

-- 1) Adiciona valores no enum origem_lancamento
alter type origem_lancamento add value if not exists 'titulo_baixa' before 'manual';
alter type origem_lancamento add value if not exists 'titulo_baixa_estornada' before 'manual';
alter type origem_lancamento add value if not exists 'titulo_estorno' before 'manual';
