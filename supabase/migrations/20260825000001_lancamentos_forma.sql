-- =====================================================================
-- forma_pagamento em lancamentos_financeiros + comments em avulsa/recorrencia.
-- Ver docs/superpowers/specs/2026-08-25-forma-pagamento-na-baixa-design.md.
--
-- Aditiva pura. Lancamentos anteriores a 25/08/2026 ficam com forma NULL —
-- documentado no comment da coluna, sem backfill.
-- =====================================================================

alter table lancamentos_financeiros
  add column if not exists forma_pagamento forma_pagamento null,
  add column if not exists cartao_credito_id uuid null
    references cartoes_credito(id) on delete restrict;

comment on column lancamentos_financeiros.forma_pagamento is
  'Forma efetivamente usada na baixa. Nulo em lançamentos anteriores a 25/08/2026 e em lançamentos de origem "manual" sem forma definida.';

comment on column lancamentos_financeiros.cartao_credito_id is
  'Cartão de crédito usado quando forma_pagamento = cartao_credito. Nulo caso contrário.';

create index if not exists idx_lancamentos_forma
  on lancamentos_financeiros (tenant_id, forma_pagamento)
  where forma_pagamento is not null;

create index if not exists idx_lancamentos_cartao
  on lancamentos_financeiros (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

-- Comments em avulsa/recorrencia refletem semantica "planejado".
comment on column contas_avulsas.forma_pagamento is
  'Forma PLANEJADA na criação. A forma REALIZADA fica em lancamentos_financeiros; podem divergir.';

comment on column contas_avulsas_recorrentes.forma_pagamento is
  'Forma PLANEJADA no template. A forma REALIZADA da ocorrência fica em lancamentos_financeiros; podem divergir.';
