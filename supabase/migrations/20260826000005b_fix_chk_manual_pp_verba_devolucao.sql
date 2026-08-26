-- =====================================================================
-- Higieniza chk_origem_contraparte_tem_id: o branch `manual` da CHECK
-- não listava pp_verba_devolucao_id is null, enquanto chk_origem_tem_referencia
-- já cobria. Sem hole de integridade (chk_origem_tem_referencia cobria),
-- mas assimetria entre CHECKs é code smell. Alinha pattern antes que
-- Task 11 os estenda de novo.
-- =====================================================================

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_contraparte_tem_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (origem = any(array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])
      and pedido_compra_id is not null
    ) or (
      origem = any(array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])
      and conta_avulsa_id is not null
    ) or (
      origem = any(array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])
      and titulo_receber_id is not null
    ) or (
      origem = any(array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])
      and desembolso_id is not null
    ) or (
      origem = any(array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento])
      and pp_verba_devolucao_id is not null
    ) or (
      origem = 'manual'::origem_lancamento
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    )
  );
