-- =============================================================================
-- Módulo fiscal · entrega 2 (02/10/2026): a origem do lançamento que paga
-- uma guia de imposto.
--
-- Racional
-- • A baixa de um título de Impostos a Pagar vira lançamentos de saída na
--   conta escolhida, como toda baixa. Eles precisam de uma origem própria
--   (`imposto_baixa`) para a conciliação reconhecer a guia e as travas de
--   `lancamentos_financeiros` saberem a que documento ela aponta.
-- • Fica sozinha nesta migration porque o Postgres não deixa usar um valor
--   novo de enum na mesma transação que o criou; a migration seguinte
--   (20261002100701) usa o valor nas travas e nas funções.
-- • Mudança ADITIVA: valor novo em enum; nada existente muda.
-- =============================================================================

alter type public.origem_lancamento add value if not exists 'imposto_baixa';
