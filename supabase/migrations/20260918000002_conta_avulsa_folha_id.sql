-- =====================================================================
-- RH — Rodada 3 da Folha Mensal: rastreabilidade da conta_avulsa gerada
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A Rodada 3 do subsistema Folha Mensal funde o antigo "financeiro
-- aprovar" (era Rodada 3) com "gerar conta a pagar" (era Rodada 4)
-- porque, na revisão de UI, o usuário decidiu que aprovar uma linha da
-- folha deve fazê-la já aparecer na aba "Títulos a Pagar" — o mesmo
-- lugar onde o financeiro paga aluguel, contador, etc. Isso segue o
-- padrão dos Pedidos de Produção (aprovou → some da aba PPs → aparece
-- em Títulos a Pagar).
--
-- Consequência: ao aprovar uma linha de folha_pagamento, o sistema cria
-- N contas_avulsas — uma por (folha_linha × alocação). Ex.: Sicrana
-- 60/40 (California-SP + CCH-Doca) vira 2 contas_avulsas com valores
-- rateados pelo percentual.
--
-- Para rastrear origem e evitar duplicação, esta migration adiciona:
--
--   contas_avulsas.folha_id  uuid  nullable  references folhas_pagamento
--
-- Aditiva. Coluna nasce NULL — contas_avulsas existentes (que não
-- vieram de folha) permanecem sem folha_id. Não há default; a coluna
-- é populada explicitamente pelo aprovador da linha de folha.
--
-- Ver docs/decisions/088-folha-mensal-em-duas-camadas.md.
-- =====================================================================

alter table public.contas_avulsas
  add column if not exists folha_id uuid references public.folhas_pagamento(id) on delete restrict;

create index if not exists idx_contas_avulsas_folha
  on public.contas_avulsas (folha_id)
  where folha_id is not null;

comment on column public.contas_avulsas.folha_id is
  'Se a conta veio da aprovacao de uma linha de folha_pagamento, aponta pra ela. Serve pra: (1) rastreabilidade (audit e relatorios), (2) idempotencia (aprovar duas vezes a mesma linha nao duplica contas), (3) estorno futuro (desaprovar uma folha remove as contas que ela gerou).';
