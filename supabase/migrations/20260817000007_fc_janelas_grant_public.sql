-- =====================================================================
-- Correção de GRANT nas funções de janela de pagamento
-- =====================================================================
--
-- A migration 20260817000006 revogou `execute` de `public` nas três
-- funções novas, seguindo o padrão que o projeto usa nas RPCs
-- (`emitir_faturamento`, `dar_baixa_titulo_com_plano` e companhia).
--
-- Para as duas funções de DATA o padrão estava mal aplicado, e quebrou
-- na primeira conferência: `select * from vw_fluxo_caixa` devolveu
-- "permission denied for function fc_proxima_janela_pagamento".
--
-- Por que devolver ao `public`:
--
--   • As duas são aritmética de data pura — `immutable`, sem acesso a
--     tabela nenhuma. Não há dado a proteger nelas.
--   • A view CHAMA a função, e o teste de `execute` é feito contra quem
--     consulta, não contra o dono da view. Logo, qualquer papel que leia
--     `vw_fluxo_caixa` precisa do `execute` — não só `authenticated`.
--     Quem regula o acesso é o `grant select` da view, que continua
--     valendo só para `authenticated`.
--   • As RPCs que motivaram o padrão são outra coisa: escrevem, emitem
--     nota, dão baixa. Comparar as duas famílias foi o erro.
--
-- `fc_saldos_por_conta` NÃO volta para o `public`: essa lê
-- `lancamentos_financeiros` e `contas_bancarias`, então segue restrita a
-- `authenticated`, como a 000006 deixou.
--
-- LADO DESTRUTIVO: NENHUM. Só GRANT.
-- =====================================================================

grant execute on function public.fc_ajusta_dia_util(date) to public;
grant execute on function public.fc_proxima_janela_pagamento(date) to public;

-- CONFERÊNCIA
--
--   select p.proname,
--          coalesce(array_to_string(p.proacl, ' | '), 'default (public)')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'fc\_%';
