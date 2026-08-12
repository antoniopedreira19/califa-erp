-- =====================================================================
-- Contas avulsas: renomear pendente -> aprovada (Migration A: safe add)
-- Ver spec: docs/superpowers/specs/2026-08-12-aprovacao-financeira-fluxo-caixa-design.md
-- Migration B (remoção de 'pendente') vem na task 11, depois do código migrar.
-- =====================================================================

-- 1. Adiciona valor 'aprovada' ao enum (não pode ser usado na mesma transação)
alter type conta_avulsa_status add value if not exists 'aprovada' before 'baixada';
