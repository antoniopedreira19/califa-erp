-- =====================================================================
-- Origens novas do lançamento: as duas pernas da transferência entre
-- contas (decisão 124)
-- =====================================================================
--
-- Sozinha de propósito: valor novo de enum só pode ser usado depois de
-- commitado, e a migration seguinte (20260929600003) já o usa em CHECK,
-- política e função (docs/FLUXO-BANCO.md).
-- =====================================================================

alter type public.origem_lancamento add value if not exists 'transferencia_saida';
alter type public.origem_lancamento add value if not exists 'transferencia_entrada';
