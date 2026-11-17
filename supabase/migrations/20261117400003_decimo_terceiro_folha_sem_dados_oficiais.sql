-- Reverte a coluna `dados_oficiais` em decimo_terceiro_folhas.
--
-- Contexto: a coluna foi adicionada numa iteração anterior pensando em
-- travar "Novo adiantamento" e "Fechar parcela" até o RH marcar a folha
-- como oficial. Decisão revogada — não vamos manter conceito/flag/UI
-- separados pra isso. O fluxo volta ao original: o que dispara linha em
-- folhas_pagamento é a ação explícita do RH (botão "Fechar parcela" ou
-- "Novo adiantamento"); quando isso rodar, a linha aparece no /perfil
-- do colaborador.
--
-- Mudança destrutiva autorizada explicitamente pelo condutor da sessão.
-- Nenhuma folha tinha dados_oficiais=true ainda (coluna acabou de nascer
-- com default false e não houve chamada da action de oficializar), então
-- a reversão é segura.

ALTER TABLE public.decimo_terceiro_folhas
  DROP COLUMN IF EXISTS dados_oficiais;
