-- Os projetos que ficaram com a sigla "0" no lugar da do cliente.
--
-- Eram três, e não eram o mesmo caso. Olhando os jobs de cada um, a
-- diferença apareceu:
--
--   producao   0-0002/26  IMC STELLA ARTOIS        AMBEV   JOB-0031
--   financeiro 0-0002/26  Stella Artois Unificado  AMBEV   JOB-0031
--     → o par do MESMO trabalho, os dois já na AMBEV. Só a sigla erra.
--
--   financeiro 0-0001/26  Projeto Teste 1          AMBEV   JOB-0029, JOB-0033
--     → estes dois jobs, na PRODUÇÃO, estão em `PEV-0007/26`, do
--       Pevetech. O mesmo trabalho aponta para clientes diferentes nas
--       duas tabelas, e trocar só a sigla para AMB consolidaria o erro:
--       ele vai para o Pevetech e recebe o código do par de produção.
--
-- A numeração segue a regra que o Tiago definiu ontem — o último recebe o
-- número seguinte, sem reaproveitar buraco. O maior AMB é o 0004 (o
-- Beats), então o Stella fica com 0005 nas duas tabelas, que é onde ele
-- já estava: par com o mesmo código.
--
-- Os JOBS não mudam de código: JOB-0029, JOB-0031 e JOB-0033 são
-- numeração global.
--
-- ⚠️ Fica de fora, porque não é sigla "0" e mexe em trabalho real:
-- `NOV-0001/26` "Operação HitLab 2026". Na produção ele já é do cliente
-- HITLAB, mas com a sigla NOV, herdada de quando o cadastro era o "Novo";
-- e o par no financeiro (`NOO-0001/26`) continua no "Novo". Ver decisão
-- 092 §5d.

begin;

-- 1. IMC STELLA ARTOIS, o par que só erra a sigla ----------------------
update public.projetos
   set codigo = 'AMB-0005/26'
 where id = '5ca9327a-9372-4870-8d9e-314517c6812b'
   and codigo = '0-0002/26';

update public.orcamentos
   set codigo = 'AMB-0005/26-' || right(codigo, 2)
 where projeto_id = '5ca9327a-9372-4870-8d9e-314517c6812b'
   and codigo like '0-0002/26-%';

update public.projetos_financeiro
   set codigo = 'AMB-0005/26'
 where id = '1bae30ff-b827-4e87-91ce-a3fb8955e1c4'
   and codigo = '0-0002/26';

-- 2. Projeto Teste 1, que estava no cliente errado ---------------------
-- Os jobs dele (JOB-0029 e JOB-0033) são do `PEV-0007/26` na produção.
update public.projetos_financeiro
   set cliente_id = 'c4be4b5a-a963-4031-b7b7-2dd068862719',  -- Pevetech
       codigo     = 'PEV-0007/26'
 where id = 'fc6f583d-9e3e-43d1-aac6-661baf17567f'
   and codigo = '0-0001/26';

commit;
