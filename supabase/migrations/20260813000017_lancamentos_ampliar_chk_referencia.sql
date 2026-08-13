-- =====================================================================
-- Amplia chk_origem_tem_referencia (task011/012) pra incluir titulo_receber.
-- Sem isso, dar_baixa_titulo falha em runtime porque a constraint antiga
-- nao conhece origens 'titulo_*'.
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_tem_referencia;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno')
      and pedido_compra_id is not null
      and conta_avulsa_id is null
      and titulo_receber_id is null)
    or
    (origem in ('avulsa_baixa','avulsa_baixa_estornada','avulsa_estorno')
      and conta_avulsa_id is not null
      and pedido_compra_id is null
      and titulo_receber_id is null)
    or
    (origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno')
      and titulo_receber_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null)
    or
    (origem = 'manual'
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null)
  );
