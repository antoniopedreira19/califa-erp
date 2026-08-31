-- A fatura de cartão entra na tríade de `origem_lancamento`.
--
-- Todo documento estornável do sistema segue o mesmo padrão de três
-- valores no enum:
--
--   X_baixa             o lançamento vivo
--   X_baixa_estornada   o mesmo lançamento, depois de desfeito
--   X_estorno           o contra-lançamento, com estorno_de_lancamento_id
--
-- Existe para `pp`, `titulo`, `avulsa`, `desembolso` e
-- `pp_devolucao_verba` — cada um com um índice único PARCIAL sobre
-- `origem = 'X_baixa'`, que torna duas baixas vivas estruturalmente
-- impossíveis.
--
-- A baixa da fatura de cartão era a única exceção: gravava `manual` nas
-- quatro linhas (as duas pernas do pagamento e as duas do estorno), sem
-- link e sem estado. Foi por isso que `estornar_baixa_fatura_cartao`
-- conseguiu contra-lançar duas vezes o mesmo pagamento (migration
-- 20260831140001) — o invariante que impede isso nos outros cinco não
-- existia aqui.
--
-- Esta migration só ACRESCENTA os três valores. Postgres recusa usar um
-- valor de enum na mesma transação em que ele nasce, então o CHECK, o
-- índice, o backfill e as funções vão na 20260831150002.

alter type public.origem_lancamento add value if not exists 'fatura_cartao_baixa';
alter type public.origem_lancamento add value if not exists 'fatura_cartao_baixa_estornada';
alter type public.origem_lancamento add value if not exists 'fatura_cartao_estorno';
