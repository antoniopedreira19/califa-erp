-- =============================================================================
-- O câmbio fechado no recebimento do job internacional (decisão 229), parte 1
-- =============================================================================
-- A origem nova dos lançamentos de IOF e de tarifa de câmbio que o
-- recebimento antes da NF do internacional grava junto do bruto: saídas da
-- conta, ligadas ao recebimento e ao job (custo do job, decisão 229 §5).
--
-- Sozinha nesta migration: um valor novo de enum não pode ser usado na mesma
-- transação em que nasce (docs/FLUXO-BANCO.md).
-- =============================================================================

alter type public.origem_lancamento add value if not exists 'cambio_custo';
