-- Motivo: as 3 tabelas abaixo têm coluna empresa_id (FK ou não), mas
-- nunca ganharam índice nela. A partir desta iteração, todos os
-- filtros de listagem passam a fazer .in("empresa_id", [...]) —
-- sem índice, isso vira sequential scan em produção conforme o
-- volume cresce. Aditivo puro; nenhum efeito colateral.
--
-- Ver docs/superpowers/specs/2026-09-08-page-header-multi-empresa-design.md

create index if not exists idx_cartoes_credito_empresa
  on public.cartoes_credito(empresa_id);

create index if not exists idx_desembolsos_empresa
  on public.desembolsos(empresa_id);

create index if not exists idx_lancamentos_financeiros_empresa
  on public.lancamentos_financeiros(empresa_id);
