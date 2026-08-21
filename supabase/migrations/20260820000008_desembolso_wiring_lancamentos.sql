-- =====================================================================
-- Wiring de desembolso em lancamentos_financeiros:
-- - FKs para desembolso e parcela.
-- - Índices.
-- - Unique parcial para idempotência da baixa.
-- - Constraints check ampliadas.
--
-- Depende de: 20260820000006 (tabelas), 20260820000007 (enum values).
-- =====================================================================

alter table lancamentos_financeiros
  add column if not exists desembolso_id uuid null
    references desembolsos(id) on delete restrict,
  add column if not exists desembolso_parcela_id uuid null
    references desembolsos_parcelas(id) on delete restrict;

comment on column lancamentos_financeiros.desembolso_id is
  'Desembolso que este lançamento quitou (via desembolso_baixa) ou estornou. Nulo em outras origens.';
comment on column lancamentos_financeiros.desembolso_parcela_id is
  'Parcela do desembolso que este lançamento quitou. Nulo em lançamento que não veio de baixa de parcela.';

create index if not exists idx_lancamentos_desembolso
  on lancamentos_financeiros (desembolso_id)
  where desembolso_id is not null;

create index if not exists idx_lancamentos_desembolso_parcela
  on lancamentos_financeiros (desembolso_parcela_id)
  where desembolso_parcela_id is not null;

-- Idempotência: uma parcela só tem uma baixa ativa.
create unique index if not exists uniq_baixa_ativa_por_desembolso_parcela
  on lancamentos_financeiros (desembolso_parcela_id)
  where desembolso_parcela_id is not null
    and origem = 'desembolso_baixa';

-- Constraints check ampliadas — mantém regra existente + adiciona ramo desembolso.
alter table lancamentos_financeiros
  drop constraint if exists chk_origem_tem_referencia;

alter table lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno')
      and pedido_compra_id is not null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno')
      and conta_avulsa_id is not null
      and pedido_compra_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
    or
    (origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno')
      and titulo_receber_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and desembolso_id is null)
    or
    (origem in ('desembolso_baixa','desembolso_baixa_estornada','desembolso_estorno')
      and desembolso_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null)
    or
    (origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
  );

alter table lancamentos_financeiros
  drop constraint if exists chk_origem_contraparte_tem_id;

alter table lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno') and pedido_compra_id is not null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno') and conta_avulsa_id is not null)
    or
    (origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno') and titulo_receber_id is not null)
    or
    (origem in ('desembolso_baixa','desembolso_baixa_estornada','desembolso_estorno') and desembolso_id is not null)
    or
    (origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null)
  );
