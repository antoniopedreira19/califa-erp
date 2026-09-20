-- "Beats Esquenta Festivals" passa a ser da AMBEV, e a sigla NOV vai para
-- o SEBRAE (decisão 092 §5c). Dois pedidos do Tiago que dependem um do
-- outro: NOV só fica livre depois que o projeto sai do cliente "Novo".
--
-- A história, lida nas datas: o projeto nasceu em 26/08 sob o cliente
-- "Novo" — um cadastro de rascunho, sem CNPJ — como teste, e depois virou
-- trabalho de verdade, com 3 orçamentos e 2 jobs (JOB-0024 Artístico e
-- JOB-0025 Clearance). O cadastro ficou para trás; esta migration o
-- alcança.
--
-- Conferido antes: o cliente "Novo" NÃO tem faturamento, lançamento,
-- conta avulsa nem desembolso. Jobs e orçamentos não guardam `cliente_id`
-- próprio — eles o derivam do projeto —, então mover o projeto move tudo
-- que pende dele.
--
-- Três movimentos, nesta ordem obrigatória:
--
--   1. o projeto sai do "Novo" e vai para a AMBEV, marca BEATS (PRD-02,
--      que já existia), com o código passando a AMB-0004/26;
--   2. o "Novo" perde a sigla NOV, que passa a NOO (a regra da decisão
--      092: a próxima letra do NOME). O projeto que sobra com ele no
--      financeiro — "Operação HitLab 2026", sem job — acompanha;
--   3. o SEBRAE recebe NOV, e com isso o projeto dele, que já era
--      NOV-0004/26, fica CERTO sem precisar mudar.
--
-- ⚠️ `projetos_financeiro` entra de novo, pelo mesmo motivo da migration
-- anterior: ela tem o par financeiro do MESMO trabalho, com a MESMA sigla
-- do cliente. Os códigos das duas tabelas andam juntos hoje (ambos eram
-- NOV-0003/26) e continuam juntos depois (AMB-0004/26).
--
-- Os JOBS não mudam de código: JOB-0024 e JOB-0025 são numeração global.

begin;

-- 1. O Beats vai para a AMBEV -----------------------------------------
update public.projetos
   set cliente_id = 'f9430c39-aa70-4cf8-bab1-89d2001daafc',  -- AMBEV
       produto_id = 'e7c2c1e5-2a95-40ee-9ee1-fc53a2295452',  -- BEATS (PRD-02)
       codigo     = 'AMB-0004/26'
 where id = 'c4b34423-aae4-4f2f-a63f-dd2df2f181f1'
   and codigo = 'NOV-0003/26';

update public.orcamentos
   set codigo = 'AMB-0004/26-' || right(codigo, 2)
 where projeto_id = 'c4b34423-aae4-4f2f-a63f-dd2df2f181f1'
   and codigo like 'NOV-0003/26-%';

-- O par no financeiro, que é o mesmo trabalho.
update public.projetos_financeiro
   set cliente_id = 'f9430c39-aa70-4cf8-bab1-89d2001daafc',  -- AMBEV
       codigo     = 'AMB-0004/26'
 where id = '3fefbe26-27ec-435a-add6-95759a04ab04'
   and codigo = 'NOV-0003/26';

-- 2. O "Novo" libera a sigla ------------------------------------------
update public.clientes
   set codigo_curto = 'NOO'
 where id = '684519a2-cc50-4667-9e90-d08afc3af4f9'
   and codigo_curto = 'NOV';

update public.projetos_financeiro
   set codigo = 'NOO-0001/26'
 where id = '91ab73e4-240b-47be-85b2-a4a0db23f781'
   and codigo = 'NOV-0001/26';

-- 3. O SEBRAE recebe NOV ----------------------------------------------
-- O projeto dele já é NOV-0004/26 desde 27/08, de quando nasceu sob o
-- "Novo". Com a sigla no lugar certo, ele fica correto sem mudar.
update public.clientes
   set codigo_curto = 'NOV'
 where codigo_curto = 'SEBRAE';

commit;

-- ⚠️ Falta uma coisa que só a TELA mostrou, e que virou a migration
-- `20260918180004`: `jobs.produto` é texto, uma cópia do nome da marca
-- tirada na abertura, e este UPDATE não a alcança.
