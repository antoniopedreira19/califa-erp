-- =====================================================================
-- Permissões das funções da recorrência e do rateio do desembolso
--
-- Três ajustes apontados pelos advisors de segurança depois das
-- migrations de 15/09/2026. Nenhum muda comportamento de tela.
--
-- 1. `recorrencia_antecedencia_dias()` ganha `search_path` fixo
--    (function_search_path_mutable).
--
-- 2. `desembolso_aprovado_exige_rateio()` é função de GATILHO, mas estava
--    exposta como RPC para `anon` e `authenticated` (SECURITY DEFINER).
--    Gatilho não precisa de EXECUTE de quem grava — o privilégio só é
--    exigido de quem CRIA o trigger —, então revogar não afeta a trava.
--
-- 3. `gerar_ocorrencias_recorrentes()` (a rotina diária, que gera para
--    TODOS os tenants) estava executável por `authenticated`, contra o que
--    a `20260831160001` registrou: "NAO volta para authenticated. Ela e do
--    cron". Nenhuma tela a chama. Com a antecedência de 30 dias o efeito
--    de alguém disparar a rotina à mão ficou maior, então fecha agora. O
--    cron roda como `postgres` e não depende deste GRANT. A tela usa
--    `gerar_ocorrencias_da_recorrente`, que confere o tenant.
-- =====================================================================

alter function public.recorrencia_antecedencia_dias() set search_path = public;

revoke all on function public.desembolso_aprovado_exige_rateio() from public, anon, authenticated;

revoke all on function public.gerar_ocorrencias_recorrentes() from public, anon, authenticated;
