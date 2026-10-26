-- =============================================================================
-- 20261021800003 — O fechamento da conciliação é a decisão 205, não a 203
-- (task 029, fase 4)
-- =============================================================================
-- O fechamento nasceu como decisão 203, número reservado no índice para a
-- conciliação. Antes do push, o `main` já tinha uma decisão 203 de outra
-- frente, publicada em paralelo; quem ainda não tinha publicado mudou de
-- número, e o fechamento virou a 205.
--
-- As migrations 20261021800001 e 20261021800002 já foram aplicadas e ficam
-- como estão, com "decisão 203" no texto. Esta troca só os dois comentários
-- que o banco guarda.
--
-- Mudança ADITIVA: só `comment on`.
-- =============================================================================

comment on table public.conciliacao_fechamentos is
  'O fechamento da conciliação com o banco (decisão 205): um ativo por conta; com ele, o caixa da conta até `ate` não muda até reabrir. As linhas inativas são o histórico (reabertas, com o motivo, ou substituídas por um fechamento mais adiante).';

comment on function public.lancamento_respeita_o_fechamento() is
  'Decisão 205 (M4.2, opção B): recusa o insert, o delete e a troca de data, valor, natureza, conta, centro de custo ou vínculo com o banco de lançamento com data até o fechamento ativo da conciliação da conta.';
