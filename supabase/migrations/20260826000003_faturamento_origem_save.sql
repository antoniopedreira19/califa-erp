-- =====================================================================
-- SAVE — a quarta origem de item de nota fiscal
--
-- SOZINHA NA MIGRATION, de propósito: `alter type ... add value` precisa
-- de commit antes de o valor novo ser usado em constraint ou função.
-- Mesmo motivo de 20260820000007_desembolso_enum_lancamentos.sql.
--
-- A nota continua sendo DO JOB (`faturamentos.origem_tipo = 'job'`). O
-- que separa faturamento próprio de saldo em save são os ITENS — que é
-- exatamente para isso que a 20260817000005 criou `faturamento_itens`
-- (decisão 017 §2). Uma nota de R$ 109.357,52 sai com dois itens na mesma
-- parcela do envio: R$ 68.348,45 de origem `job` e R$ 41.009,07 de
-- origem `save`.
-- =====================================================================

alter type public.faturamento_origem add value if not exists 'save';
