-- 276 — A devolução ao cliente continua no fluxo de caixa (23/11/2026; Tiago: "Sim, aplique").
--
-- A regra de 03/11 (20261103100001) tira do fluxo a previsão da planilha de imposto
-- (CT, saída, sem job) com competência do 4T de 2026 em diante: dali em diante vale o
-- que o Fiscal projeta (guias da Apuração e impostos a pagar). A regra pegou também as
-- devoluções ao cliente que a planilha lança no CT: 26 linhas de 31/01/2027, R$ 131.291,61,
-- todas de ISS devolvido à Ambev ("Devolução ISS para Ambev, devolveram o ISS à agência
-- indevidamente", "Devolução / Pagamento do ISS pago indevidamente pela Ambev"...). O
-- Fiscal não gera essas saídas — não são guia de imposto —, e o fluxo deixava de mostrar
-- R$ 131 mil a pagar em janeiro.
--
-- As 181 linhas que a regra tira estão todas no mesmo plano (03.999, Geral provisório):
-- só a descrição separa a devolução do imposto. A exceção: a linha com "devolu" ou
-- "restitu" na descrição (sem acento, maiúscula ou minúscula) fica no fluxo. Conferido
-- em 23/11: são exatamente as 26 devoluções, e nenhuma linha de imposto tem essas palavras.
--
-- Quando a devolução virar conta a pagar no sistema (a transição), esta exceção sai,
-- para a devolução não contar duas vezes.
--
-- A troca é feita sobre a definição viva da view (pg_get_viewdef), só no trecho da regra,
-- para não desfazer o que outras frentes mudaram na view desde 03/11. Se o trecho não
-- estiver como esperado, a migration falha sem mudar nada. Quem reescrever a view inteira
-- depois precisa manter a condição nova.

do $migration$
declare
  v_def   text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  v_velho text := '>= 20264)), false))';
  v_novo  text := '>= 20264) AND (unaccent(COALESCE(h.descricao, ''''::text)) !~* ''(devolu|restitu)''::text)), false))';
begin
  if (length(v_def) - length(replace(v_def, v_velho, ''))) / length(v_velho) <> 1 then
    raise exception 'A regra do imposto do 4T (CT sem job) não está como esperado na vw_fluxo_caixa.';
  end if;
  execute 'create or replace view public.vw_fluxo_caixa as ' || replace(v_def, v_velho, v_novo);
end
$migration$;

-- A view continua só de leitura para quem entra no sistema (create or replace mantém os grants).
grant select on public.vw_fluxo_caixa to authenticated;
revoke all on public.vw_fluxo_caixa from anon;
