-- Rescisão de colaborador: quando inativamos alguém, as linhas de folha
-- (mensal, 13º e férias) que ainda não foram pagas precisam sair da fila
-- de pagamento, mas sem perder o rastro de que existiram. Em vez de
-- DELETE, usamos um status terminal próprio: `cancelada_rescisao`.
--
-- Por que não reusar `pendente_correcao`: aquele status é um retorno
-- válido pro fluxo (RH volta a editar). `cancelada_rescisao` é terminal
-- — não aparece em listas "em andamento", não entra em recálculo, e o
-- banner da linha explica o motivo ("colaborador desligado em DD/MM").
--
-- ADD VALUE precisa ir numa migration isolada da RPC que usa o valor
-- (Postgres proíbe criar e consumir enum value na mesma transação).

ALTER TYPE folha_linha_status ADD VALUE IF NOT EXISTS 'cancelada_rescisao';
