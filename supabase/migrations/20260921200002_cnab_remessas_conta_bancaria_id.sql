-- =====================================================================
-- cnab_remessas: empresa_contabil_id → conta_bancaria_id
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Consequência direta da migration 20260921200001 (ADR 004): agora
-- que convênio e sequencial moram em contas_bancarias, cada arquivo
-- é gerado a partir de UMA conta específica — cnab_remessas precisa
-- apontar pra ela.
--
-- SEGURO PORQUE:
--   • 0 registros em cnab_remessas hoje.
--   • Nenhum código lê essa coluna (o gerador ainda não foi escrito).
--
-- Destrutiva-parcial mas sem impacto de dado.
-- =====================================================================

-- Constraint antiga (empresa_contabil_id, sequencial_arquivo) sai
alter table public.cnab_remessas
  drop constraint if exists uniq_cnab_remessas_sequencial;

-- Índice antigo por empresa_contabil sai
drop index if exists public.idx_cnab_remessas_empresa;

-- Coluna nova
alter table public.cnab_remessas
  add column if not exists conta_bancaria_id uuid
    references public.contas_bancarias(id) on delete restrict;

-- Coluna antiga sai (0 registros)
alter table public.cnab_remessas
  drop column if exists empresa_contabil_id;

-- Agora conta_bancaria_id vira NOT NULL
alter table public.cnab_remessas
  alter column conta_bancaria_id set not null;

-- Constraint nova
alter table public.cnab_remessas
  add constraint uniq_cnab_remessas_sequencial
    unique (conta_bancaria_id, sequencial_arquivo);

-- Índice novo
create index if not exists idx_cnab_remessas_conta_bancaria
  on public.cnab_remessas (conta_bancaria_id, sequencial_arquivo desc);

comment on column public.cnab_remessas.conta_bancaria_id is
  'Conta bancária que sofre o débito consolidado do arquivo. O convênio '
  'e o sequencial usados no arquivo saem dessa conta. Movido de '
  'empresa_contabil_id em 21/09/2026 (ADR 004) — cada arquivo é gerado '
  'a partir de UMA conta, não de uma PJ inteira.';
