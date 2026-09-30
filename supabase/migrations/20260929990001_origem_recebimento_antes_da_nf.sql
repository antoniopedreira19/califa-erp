-- =====================================================================
-- Origem nova do lançamento: o recebimento antes da NF (decisão 130)
-- =====================================================================
--
-- Sozinha de propósito: valor novo de enum só pode ser usado depois de
-- commitado, e a migration seguinte (20260929990002) já o usa em CHECK e
-- nas funções (docs/FLUXO-BANCO.md).
-- =====================================================================

alter type public.origem_lancamento add value if not exists 'recebimento_antes_nf';
