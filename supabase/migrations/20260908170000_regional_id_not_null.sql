-- Fecha o loop da Fase 2A: agora que a UI cascata empresa->regional
-- exige regional em toda tela de criacao (contas avulsas, recorrentes,
-- lancamentos avulsos e titulos a receber), regional_id nas 3 tabelas
-- passa a ser NOT NULL. Se algum registro veio null, e bug de tela —
-- corrigir a tela antes de aplicar esta migration.
--
-- Sanity check pre-aplicacao (2026-09-08): count(*) filter (where regional_id is null)
-- retornou 0 nas 3 tabelas — backfill da Fase 1 (A1) cobriu 100%.
--
-- Ver docs/superpowers/specs/2026-09-08-fase2a-cascata-empresa-regional-design.md

alter table public.contas_avulsas          alter column regional_id set not null;
alter table public.lancamentos_financeiros alter column regional_id set not null;
alter table public.titulos_receber         alter column regional_id set not null;
