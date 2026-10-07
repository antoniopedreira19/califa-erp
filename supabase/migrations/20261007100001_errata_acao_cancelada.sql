-- Decisão 150 (07/10/2026): a errata não remove mais linha do job — ela
-- CANCELA. A linha fica na planilha com o orçado zerado e o planejado da
-- abertura continua contando no resultado planejado.
--
-- O histórico da errata (`jobs_erratas_itens.acao`) ganha a ação
-- `cancelada`. As cinco remoções que já existem no histórico continuam
-- `removida`: elas apagaram a linha de verdade, e o texto delas não muda.
--
-- Sozinha nesta migration: valor novo de enum não pode ser usado na mesma
-- transação em que é criado (docs/FLUXO-BANCO.md).

alter type public.errata_acao add value if not exists 'cancelada';
