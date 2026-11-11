-- =============================================================================
-- 20261111900001 — A conta interna do fechamento sem acesso direto do usuário
-- logado (decisão 254; Tiago, 11/11/2026)
-- =============================================================================
-- `_condicoes_do_fechamento(conta, data)` é SECURITY DEFINER e não confere o
-- papel de quem chama: quem confere são as funções públicas que a usam
-- (`condicoes_do_fechamento`, `saldos_dos_dias_em_aberto`, `fechar_conciliacao`,
-- todas SECURITY DEFINER, do mesmo dono). A migration que a criou
-- (20261021800001) já retirava o EXECUTE de `authenticated`, mas a permissão
-- estava de volta no banco: qualquer usuário logado, de qualquer tenant, lia
-- o saldo de uma conta bancária pelo id.
--
-- Retira de novo. Nada na aplicação chama esta função direto. Confirmado pelo
-- Tiago em 11/11/2026 (retirar permissão não é mudança aditiva).
-- =============================================================================

revoke all on function public._condicoes_do_fechamento(uuid, date) from public, anon, authenticated;
