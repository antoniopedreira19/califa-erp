-- =====================================================================
-- DROP forma_pagamento e cartao_credito_id de pedidos_compra e desembolsos.
-- Ver docs/superpowers/specs/2026-08-25-forma-pagamento-na-baixa-design.md.
--
-- DESTRUTIVA. User confirmou explicitamente no spec (seção 3.1). Aplicada
-- por último na sequência: se algo desse errado nos passos anteriores,
-- dava pra reverter sem perder dados. Nesse ponto, todo consumidor das
-- colunas já foi removido (Tasks 5 e 6).
-- =====================================================================

alter table pedidos_compra
  drop constraint if exists chk_pp_cartao,
  drop column if exists cartao_credito_id,
  drop column if exists forma_pagamento;

drop index if exists idx_pp_cartao;

alter table desembolsos
  drop constraint if exists chk_desembolso_cartao,
  drop column if exists cartao_credito_id,
  drop column if exists forma_pagamento;

drop index if exists idx_desembolsos_cartao;
