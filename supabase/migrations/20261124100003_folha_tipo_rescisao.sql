-- Rescisão vira quarto tipo de folha_pagamento (junto com salario,
-- ferias, decimo_terceiro_*): assim cai na aba People do financeiro
-- pelo mesmo caminho das outras (view `vw_people_aprovar_financeiro`),
-- obedece à RLS de folha (tenant + role, não acesso regional) e o
-- status flui por `folha_linha_status` (enviada → paga) como as
-- demais, sem precisar de avulsa.
--
-- ADD VALUE em transação separada por causa da regra do Postgres.

alter type folha_tipo add value if not exists 'rescisao';
alter type nf_anexo_escopo add value if not exists 'rescisao';
