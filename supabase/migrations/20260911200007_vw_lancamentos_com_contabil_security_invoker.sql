-- =====================================================================
-- Advisor de segurança flagou vw_lancamentos_com_contabil com
-- SECURITY DEFINER (comportamento default do postgres). A view junta
-- lancamentos_financeiros + contas_bancarias + empresas_contabeis —
-- todas com RLS por tenant. Sem security_invoker=on, a view executa com
-- os privilégios do criador (postgres/superuser) e IGNORA RLS: qualquer
-- authenticated leria lançamentos de todos os tenants.
--
-- Fix cirúrgico: ativa security_invoker só nesta view. As 4 outras views
-- do projeto (vw_a_pagar, vw_faturamento_pendente, vw_fluxo_caixa,
-- vw_fluxo_caixa_job_totais) têm o mesmo defeito pré-existente — fora
-- do escopo desta frente (não introduzido por ela).
-- =====================================================================

alter view public.vw_lancamentos_com_contabil set (security_invoker = on);
