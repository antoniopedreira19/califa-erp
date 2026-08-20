-- Racional: adiciona forma_pagamento (nullable) e cartao_credito_id
-- (FK opcional) nas 3 tabelas de origem de "Contas a Pagar". Nullable
-- preserva os 10 títulos existentes anteriores a 20/08/2026 — não
-- converter em NOT NULL sem backfill explícito. Check constraint
-- garante coerência: se cartão, exige cartao_credito_id; se não-cartão,
-- exige que ele seja NULL. Índice parcial permite filtro rápido na aba
-- "Títulos a Pagar (Cartão)". Ver spec seções 3.1, 3.2 e 4.2.

alter table pedidos_compra
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id);

alter table pedidos_compra
  add constraint chk_pp_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

comment on column pedidos_compra.forma_pagamento is
  'Nullable para preservar títulos anteriores a 20/08/2026. Não converter em NOT NULL sem backfill explícito.';

alter table contas_avulsas
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id);

alter table contas_avulsas
  add constraint chk_avulsa_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

comment on column contas_avulsas.forma_pagamento is
  'Nullable para preservar títulos anteriores a 20/08/2026. Não converter em NOT NULL sem backfill explícito.';

alter table contas_avulsas_recorrentes
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id);

alter table contas_avulsas_recorrentes
  add constraint chk_recorrente_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

comment on column contas_avulsas_recorrentes.forma_pagamento is
  'Nullable para preservar templates anteriores a 20/08/2026. Não converter em NOT NULL sem backfill explícito.';

-- Índices parciais para o filtro/agrupamento da aba "Títulos a Pagar (Cartão)"
create index idx_pp_cartao
  on pedidos_compra (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

create index idx_avulsa_cartao
  on contas_avulsas (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

create index idx_recorrente_cartao
  on contas_avulsas_recorrentes (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;
