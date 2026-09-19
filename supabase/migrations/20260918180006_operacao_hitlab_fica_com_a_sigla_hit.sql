-- A "Operação HitLab 2026" passa a ter o código do cliente dela.
--
-- Última divergência entre a sigla do projeto e o cliente, e a terceira
-- herança do cadastro de rascunho "Novo" num só dia (decisão 092 §5e):
--
--   produção    NOV-0001/26   cliente HITLAB  → sigla do antigo "Novo"
--   financeiro  NOO-0001/26   cliente "Novo"  → cliente errado
--
-- Na produção o cliente já estava certo e só a sigla ficou para trás. No
-- financeiro o par nunca saiu do rascunho. Os dois passam a ser do
-- HITLAB, com o mesmo código — que é como o par das duas tabelas anda.
--
-- O número é 0001 porque o HITLAB não tinha nenhum projeto em nenhuma das
-- duas tabelas: este é o primeiro dele.
--
-- Os 3 orçamentos estão em rascunho e não há job nenhum nas duas pontas,
-- então nada mais precisa acompanhar.
--
-- ⚠️ Depois desta migration o cliente "Novo" (NOO) fica SEM projeto
-- nenhum. Ele é um cadastro de rascunho, sem CNPJ, que já gerou três
-- confusões: o Beats, o SEBRAE e esta. O que fazer com ele ficou para o
-- Tiago decidir.

begin;

update public.projetos
   set codigo = 'HIT-0001/26'
 where id = '0ed6025e-fa20-4b91-b4a8-deafd05cfdf2'
   and codigo = 'NOV-0001/26';

update public.orcamentos
   set codigo = 'HIT-0001/26-' || right(codigo, 2)
 where projeto_id = '0ed6025e-fa20-4b91-b4a8-deafd05cfdf2'
   and codigo like 'NOV-0001/26-%';

update public.projetos_financeiro
   set cliente_id = 'abc63a94-8067-4db8-8ddd-70895325eae7',  -- HITLAB
       codigo     = 'HIT-0001/26'
 where id = '91ab73e4-240b-47be-85b2-a4a0db23f781'
   and codigo = 'NOO-0001/26';

commit;
