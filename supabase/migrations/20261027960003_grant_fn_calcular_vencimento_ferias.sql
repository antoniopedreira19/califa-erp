-- =====================================================================
-- Fix: GRANT EXECUTE em fn_calcular_vencimento_ferias pra authenticated
--
-- Por que: a função foi criada em 2026-10-03 sem GRANT. O caller
-- `criarFolhasDePagamentoDeFerias` (chamado por `aprovarLancamento`)
-- faz supabase.rpc("fn_calcular_vencimento_ferias", …) rodando como
-- authenticated e levava "permission denied for function". O erro
-- é apenas console.warn'ado em actions.ts, então o RH aprovava o
-- lançamento, nenhuma folha era criada, e o card aparecia no kanban
-- "Em andamento" com 0/0 documentos.
--
-- Caso real: Antonio Pedreira (TESTE), lançamento
-- 6db106e8-b4ce-4870-a57d-739adaeee1e2 aprovado em 2026-10-27 22:45
-- ficou sem folhas. Backfill manual é feito pelo RH re-aprovando
-- após este GRANT (ou via SQL direto).
--
-- Mudança aditiva (apenas GRANT), reversível.
-- =====================================================================

GRANT EXECUTE ON FUNCTION public.fn_calcular_vencimento_ferias(date) TO authenticated;
