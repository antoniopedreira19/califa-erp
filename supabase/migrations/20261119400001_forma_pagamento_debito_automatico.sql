-- Racional: adiciona 'debito_automatico' ao enum forma_pagamento.
-- Custos fixos recorrentes (internet, telefone, assinaturas, etc.) sao
-- cobrados via debito automatico em conta, modalidade que ate entao nao
-- existia no enum. Aditivo: nao altera registros existentes nem policies.

alter type forma_pagamento add value if not exists 'debito_automatico';
