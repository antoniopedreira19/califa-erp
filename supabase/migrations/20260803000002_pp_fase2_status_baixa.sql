-- =====================================================================
-- PP fase 2 — status enum + soft delete + prazo financeiro + unique parcial
-- Ver spec: docs/superpowers/specs/2026-08-03-pedidos-compra-fase2-design.md
-- =====================================================================

-- 1. Enum de status (baixada fica pra fase 3)
do $$ begin
  create type pp_status as enum ('emitida', 'cancelada');
exception when duplicate_object then null;
end $$;

-- 2. Novas colunas em pedidos_compra
alter table public.pedidos_compra
  add column if not exists status pp_status not null default 'emitida',
  add column if not exists prazo_pagamento_financeiro date,
  add column if not exists cancelada_por uuid references public.profiles(id),
  add column if not exists cancelada_em timestamptz,
  add column if not exists motivo_cancelamento text;

-- 3. Índice para chips de filtro
create index if not exists idx_pp_status
  on public.pedidos_compra(tenant_id, status);

-- 4. Substituir unique(item_realizado_id) por unique parcial: só bloqueia
-- se existir PP não cancelada. Sem isso, cancelar uma PP e gerar nova no
-- mesmo item falha por unique constraint (soft delete quebra a assumption
-- da fase 1 que era hard delete).
alter table public.pedidos_compra
  drop constraint if exists uniq_pp_por_item_realizado;

create unique index if not exists uniq_pp_ativa_por_item_realizado
  on public.pedidos_compra(item_realizado_id)
  where status != 'cancelada';
