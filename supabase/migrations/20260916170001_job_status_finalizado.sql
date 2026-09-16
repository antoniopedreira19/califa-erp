-- =====================================================================
-- Decisão 087 — o job ganha o status "finalizado"
-- =====================================================================
-- Faturamento e encerramento deixam de ser uma fila única (16/09/2026). O
-- job pode ser faturado sem estar encerrado e encerrado sem estar
-- faturado; quando as duas coisas terminam, ele fica FINALIZADO.
--
-- `encerrado` passa a significar "a produção fechou o job" — nada mais
-- sobre o faturamento. `finalizado` é o fim da linha: encerrado E com todo
-- o envio para faturamento coberto por nota emitida.
--
-- Fica sozinha nesta migration: um valor novo de enum não pode ser usado
-- na mesma transação em que é criado (docs/FLUXO-BANCO.md). Quem usa o
-- valor vem na 20260916170002 e na 20260916170003.
-- =====================================================================

alter type public.job_status add value if not exists 'finalizado';
