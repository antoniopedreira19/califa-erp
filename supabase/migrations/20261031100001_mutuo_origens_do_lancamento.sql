-- =====================================================================
-- Mútuo entre empresas (decisão 230): as duas origens do lançamento
-- =====================================================================
--
-- Sozinha nesta migration: valor novo de enum não pode ser usado na mesma
-- transação em que nasce. A estrutura vem na migration seguinte.
-- =====================================================================

alter type public.origem_lancamento add value if not exists 'mutuo_saida';
alter type public.origem_lancamento add value if not exists 'mutuo_entrada';
