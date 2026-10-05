-- =====================================================================
-- A receita anterior da LC 224 só para administrador e financeiro
-- (decisão 145, item 7)
-- =====================================================================
--
-- `20261004100003` criou a tabela com a leitura aberta a todo membro do
-- tenant, como as outras `fiscal_*`. Mas a receita por PJ e trimestre é
-- dado de faturamento: GP, produção e freelancer não leem. Sai a política
-- de leitura geral; fica a `_modify` (FOR ALL), que já dá a leitura a
-- administrador e financeiro. Quem mais carregar o cadastro de impostos
-- recebe a lista vazia, e o motor só avisa.
-- =====================================================================

drop policy if exists fiscal_receitas_anteriores_select on public.fiscal_receitas_anteriores;
