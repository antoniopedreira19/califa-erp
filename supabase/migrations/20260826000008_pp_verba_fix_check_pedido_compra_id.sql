-- =====================================================================
-- Fix: chk_origem_tem_referencia e chk_origem_contraparte_tem_id exigiam
-- pedido_compra_id IS NULL para pp_devolucao_verba* — mas a devolução
-- PRECISA carregar pedido_compra_id para que queries de realizado do job
-- somem o crédito da devolução ao custo original da PP (spec §8.1).
--
-- Root cause: migration 20260826000005 (e o patch 20260826000005b) criou
-- o branch de devolução de verba com pedido_compra_id IS NULL, copiando
-- a estrutura de mutual exclusividade das outras origens. Porém para
-- pp_devolucao_verba o pedido_compra_id é necessário e preenchido pelo
-- RPC dar_baixa_devolucao_verba — causando CHECK VIOLATION em toda tentativa
-- de baixa (segundo semi-branch do feature inacessível end-to-end).
--
-- Fix: para pp_devolucao_verba e pp_devolucao_verba_estornada:
--   - chk_origem_tem_referencia: exige pp_verba_devolucao_id NOT NULL
--     E pedido_compra_id NOT NULL; outros FKs NULL.
--   - chk_origem_contraparte_tem_id: mesma lógica (espelho sem mutual exclusividade).
--
-- Todos os outros branches ficam byte-a-byte iguais ao que o MCP leu
-- antes desta migration.
-- =====================================================================

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_tem_referencia;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (
      origem = any(array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])
      and pedido_compra_id is not null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    ) or (
      origem = any(array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])
      and conta_avulsa_id is not null
      and pedido_compra_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    ) or (
      origem = any(array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])
      and titulo_receber_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    ) or (
      origem = any(array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])
      and desembolso_id is not null
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and pp_verba_devolucao_id is null
    ) or (
      -- FIX: pedido_compra_id agora é NOT NULL para estas origens (era IS NULL).
      -- A devolução precisa do pedido_compra_id para que o realizado do job
      -- inclua o crédito da devolução na somatória do custo da PP (spec §8.1).
      origem = any(array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento])
      and pp_verba_devolucao_id is not null
      and pedido_compra_id is not null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
    ) or (
      origem = 'manual'::origem_lancamento
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    )
  );

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_contraparte_tem_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (
      origem = any(array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])
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
      -- FIX: pedido_compra_id agora é NOT NULL para estas origens (era só pp_verba_devolucao_id).
      origem = any(array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento])
      and pp_verba_devolucao_id is not null
      and pedido_compra_id is not null
    ) or (
      origem = 'manual'::origem_lancamento
      and pedido_compra_id is null
      and conta_avulsa_id is null
      and titulo_receber_id is null
      and desembolso_id is null
      and pp_verba_devolucao_id is null
    )
  );
