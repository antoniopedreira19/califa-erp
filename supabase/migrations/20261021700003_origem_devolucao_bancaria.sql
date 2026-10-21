-- =====================================================================
-- A origem nova do "Saiu e voltou" (task 029, fase 3, entrega 3B — decisão 200)
-- =====================================================================
--
-- O banco devolveu o pagamento no mesmo dia: a saída e a devolução entram
-- no extrato do sistema, fora do DRE, como as pernas de uma transferência,
-- e o título continua a pagar (M3.6, opção A, Tiago em 21/10/2026).
--
-- O valor novo do enum vai numa migration só dele (como o `juros_baixa`,
-- decisão 196): `alter type ... add value` não pode ser usado na mesma
-- transação que o cria. As travas, a policy e as funções que o usam vêm na
-- migration seguinte.
--
-- Aditiva: um valor novo no enum.
-- =====================================================================

alter type public.origem_lancamento add value if not exists 'devolucao_bancaria';
