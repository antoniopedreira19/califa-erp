-- O fluxo de caixa volta a ler a vw_fluxo_caixa (26/11/2026).
--
-- A view chama duas funções internas no ramo "previsao_planilha":
--   - _historico_previsoes_pagas(uuid)  (20261123600005/600006/950002);
--   - _previsao_de_nf_lancada(uuid, text, text, text)  (20261123950001).
-- As duas nasceram com `revoke all ... from public, anon, authenticated`.
-- Mas o Postgres confere a permissão de EXECUTE das funções usadas numa view
-- no usuário que lê a view (não no dono da view): o usuário logado recebia
-- "permission denied for function _historico_previsoes_pagas", e a página
-- do Fluxo de caixa abria sem nenhuma linha da view (sem entradas, sem
-- realizado; só as saídas do Fiscal, que vêm à parte). Na produção, o saldo
-- projetado aparecia em −R$ 6,9 mi.
--
-- Correção, com o OK do Tiago (26/11): EXECUTE para `authenticated`; `anon`
-- continua sem. As funções são SECURITY DEFINER e devolvem só ids de linhas
-- do histórico já pagas (a primeira) e um sim/não (a segunda), sem valores
-- nem nomes. Aditiva: só concede.

grant execute on function public._historico_previsoes_pagas(uuid) to authenticated;
grant execute on function public._previsao_de_nf_lancada(uuid, text, text, text) to authenticated;
