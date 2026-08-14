-- Corrige o `valor_total` do JOB-0001.
--
-- O job foi criado antes de o fluxo estar estruturado, quando o drawer
-- ainda tinha um campo de valor editável à mão. Ficou gravado
-- R$ 1.000.000,00 sobre um único item orçado de R$ 4.000,00 (tipo B).
-- O campo editável já foi removido (ver comentário no topo de
-- `app/(app)/jobs/actions.ts`); sobrou o dado.
--
-- O número correto sai de `calcularTotaisVersao`:
--   subtotal            4.000,00  (1 item, tipo B)
--   honorários 13%        520,00  (B entra na base de honorários)
--   imposto 19,53% "por dentro":
--       (4.000 + 520) * 0,1953 / (1 - 0,1953) = 1.097,00
--   Valor do Job = 4.000 + 520 + 1.097 = 5.617,00
--
-- Bate com `faturamento_previsto` e com `valor_job_abertura`, que já
-- estavam em 5.617,00 — só a coluna `valor_total` divergia. Conferido
-- pelo MCP em 14/08/2026: dos 11 jobs, este é o ÚNICO com divergência
-- entre o gravado e o recalculado dos itens.
--
-- Autorizado explicitamente pelo Tiago em 14/08/2026.
--
-- A guarda no WHERE torna a migration idempotente e impede que ela
-- toque em qualquer outro job: se o valor já tiver sido corrigido, ou se
-- não for o número errado esperado, nada acontece.

update jobs
   set valor_total = 5617.00
 where codigo = 'JOB-0001'
   and valor_total = 1000000.00;
