-- =====================================================================
-- Complemento da migration 20260827000004: falta ampliar
-- chk_origem_tem_referencia para aceitar pp_devolucao_verba_estorno
-- (o reverso do estorno) — sem isso o INSERT do reverso pela
-- RPC estornar_baixa_devolucao_verba viola essa CHECK.
--
-- Erro descoberto na sequencia do E2E de 27/08/2026, apos aplicar
-- 000004: a 000004 ajustou chk_origem_contraparte_tem_id mas nao
-- chk_origem_tem_referencia (que tem uma lista analoga por origem).
-- =====================================================================

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_tem_referencia;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem in ('pp_baixa', 'pp_baixa_estornada', 'pp_estorno')
     and pedido_compra_id is not null and conta_avulsa_id is null
     and titulo_receber_id is null and desembolso_id is null
     and pp_verba_devolucao_id is null)
    or (origem in ('avulsa_baixa', 'avulsa_baixa_estornada', 'avulsa_estorno')
     and conta_avulsa_id is not null and pedido_compra_id is null
     and titulo_receber_id is null and desembolso_id is null
     and pp_verba_devolucao_id is null)
    or (origem in ('titulo_baixa', 'titulo_baixa_estornada', 'titulo_estorno')
     and titulo_receber_id is not null and pedido_compra_id is null
     and conta_avulsa_id is null and desembolso_id is null
     and pp_verba_devolucao_id is null)
    or (origem in ('desembolso_baixa', 'desembolso_baixa_estornada', 'desembolso_estorno')
     and desembolso_id is not null and pedido_compra_id is null
     and conta_avulsa_id is null and titulo_receber_id is null
     and pp_verba_devolucao_id is null)
    or (origem in ('pp_devolucao_verba', 'pp_devolucao_verba_estornada', 'pp_devolucao_verba_estorno')
     and pp_verba_devolucao_id is not null and pedido_compra_id is not null
     and conta_avulsa_id is null and titulo_receber_id is null and desembolso_id is null)
    or (origem = 'manual'
     and pedido_compra_id is null and conta_avulsa_id is null
     and titulo_receber_id is null and desembolso_id is null
     and pp_verba_devolucao_id is null)
  );
