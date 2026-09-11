-- =====================================================================
-- Trava: toda conta bancária tem PJ contábil. Backfill fechado nas
-- migrations 200003 (aditiva), 200004 (trigger de cartão), 200004a
-- (backfill das contas existentes) e no processo manual de 20260911.
-- =====================================================================

alter table public.contas_bancarias
  alter column empresa_contabil_id set not null;
