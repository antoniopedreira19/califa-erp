-- =====================================================================
-- "Em produção" sai do fluxo do job.
--
-- O status não separava nada: os cinco gates de negócio (lançar
-- realizado, gerar PP, cancelar PP, registrar errata, editar a planilha)
-- sempre aceitaram `aberto` OU `em_producao` de forma idêntica. A única
-- diferença era a máquina de transições, onde `em_producao` era um degrau
-- obrigatório entre `aberto` e o encerramento — um clique a mais que não
-- mudava o que o usuário podia fazer.
--
-- Conforme o design "Jobs - Fluxo", o job aberto pelo financeiro fica
-- "Aberto" até ser encerrado.
--
-- O valor `em_producao` continua no enum, sem uso: o Postgres não remove
-- valor de enum sem recriar o tipo, e recriar derrubaria a coluna, os
-- defaults e as policies que dependem dele — risco sem ganho prático.
-- =====================================================================

update public.jobs
set status = 'aberto'
where status = 'em_producao';
