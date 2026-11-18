-- O fluxo de caixa da produção voltou sem entradas nem realizado (18/11/2026):
-- a `vw_fluxo_caixa` inteira falhava para os usuários da produção com
-- "cartao_credito não encontrado: 33416603-…".
--
-- Causa: `proxima_fatura_cartao` (a data da fatura em que cai a PP paga no
-- cartão) lia o cartão como o usuário, pelo RLS de `cartoes_credito`
-- (`can_access_empresa_regional` da empresa do cartão). O cartão de teste
-- "ZZ Teste Empresa Teste" ficou no tenant da produção com a empresa "Empresa
-- Teste", que foi para o Sandbox: ninguém da produção o enxerga, a função não
-- acha o dia de vencimento e levanta exceção — e uma linha derruba a view
-- toda (a tela lê página a página e, com o erro na primeira, fica só com o
-- que não vem da view). Cinco PPs da produção estão nesse cartão (PP-00044,
-- PP-00210, PP-00397, PP-00824, PP-00950); o cartão certo delas segue com o
-- Tiago.
--
-- Correção: a função lê o cartão como dona (`security definer`). Ela só
-- devolve uma data (o vencimento da próxima fatura); quem vê a PP já via a
-- linha. A exceção fica: com a leitura sem RLS, só aconteceria com cartão
-- inexistente, o que a FK impede. Conferido antes numa transação desfeita:
-- a view volta a responder para o usuário da produção (1,6 s).

alter function public.proxima_fatura_cartao(uuid, date) security definer;

comment on function public.proxima_fatura_cartao(uuid, date) is
  'Vencimento da próxima fatura do cartão para uma data. Security definer (18/11/2026): lê o cartão sem RLS, para uma PP num cartão que o usuário não enxerga não derrubar a vw_fluxo_caixa inteira.';
