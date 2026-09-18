-- Normaliza os códigos de cliente que fugiam do padrão de 3 letras, com
-- os projetos e os orçamentos acompanhando (decisão 092 §5).
--
-- O Tiago decidiu caso a caso, olhando a lista:
--
--   Pevetech   PEVETE → PEV   + 5 projetos e 17 orçamentos
--   Teste      TESTE  → TES   (sem projeto)
--   Teste 22   teste22 → TET  + 1 projeto e 1 orçamento
--
--   INSTITUTO FEIRA PRETA (FP) e SMARTFIT (SF)  → FICAM COMO ESTÃO.
--     Duas letras, de propósito. O código é escolha de quem cadastra, e
--     não uma consequência do nome: metade da base é apelido (EBAZAR.COM.BR
--     é MEL, BEACH PARK é CBP).
--
--   SEBRAE → pendente. O Tiago pediu `NOV`, mas NOV já é do cliente
--     "Novo" (projeto NOV-0003/26). Fica para uma migration própria,
--     depois da decisão — ver decisão 092 §5c.
--
-- O `0-0001/26` do Pevetech tinha sigla "0" e número 0001 escritos à mão,
-- que não conversam com a numeração do cliente. Ele é o mais recente dos
-- cinco (01/09), então entra como o PRÓXIMO da sequência: 0007, depois do
-- 0006. Os outros quatro mantêm o número e trocam só a sigla.
--
-- Os JOBS não mudam: o código do job é global (`JOB-0033`) e não carrega
-- a sigla do cliente. Os orçamentos mudam, porque o código deles começa
-- com o do projeto — menos `ORC-0002` e `ORC-0003`, que são do formato
-- antigo e não têm sigla.
--
-- ⚠️ `projetos_financeiro` ENTRA JUNTO, ainda que seja da outra frente.
-- Ela tem projetos próprios com a MESMA sigla, gerada pelo mesmo
-- `codigo_curto` do cliente (`gerarCodigoProjetoFinanceiro`). Deixá-la de
-- fora não seria "não mexer no que é do outro": seria partir o cadastro
-- em dois — os projetos financeiros do Pevetech ficariam `PEVETE-` com o
-- cliente já em `PEV`, e o próximo código gerado lá sairia `PEV-`,
-- recriando exatamente a divergência que esta migration conserta.
-- Nenhum job muda de código por causa disso (a FK é por id).
--
-- Cada UPDATE é por id, escrito abaixo: nada é atualizado por padrão de
-- texto, para não pegar linha de outro cliente por engano.

begin;

-- ---------------------------------------------------------------- Pevetech
update public.clientes
   set codigo_curto = 'PEV'
 where id = 'c4be4b5a-a963-4031-b7b7-2dd068862719'
   and codigo_curto = 'PEVETE';

-- Projetos: os quatro que já tinham a sigla mantêm o número.
update public.projetos set codigo = 'PEV-0001/26' where codigo = 'PEVETE-0001/26';
update public.projetos set codigo = 'PEV-0003/26' where codigo = 'PEVETE-0003/26';
update public.projetos set codigo = 'PEV-0004/26' where codigo = 'PEVETE-0004/26';
update public.projetos set codigo = 'PEV-0006/26' where codigo = 'PEVETE-0006/26';
-- E o "0-0001/26" entra como o próximo da sequência.
update public.projetos set codigo = 'PEV-0007/26' where codigo = '0-0001/26';

-- Orçamentos: o código começa com o do projeto.
update public.orcamentos set codigo = 'PEV-0003/26-01' where codigo = 'PEVETE-0003/26-01';
update public.orcamentos set codigo = 'PEV-0004/26-01' where codigo = 'PEVETE-0004/26-01';
update public.orcamentos set codigo = 'PEV-0006/26-01' where codigo = 'PEVETE-0006/26-01';
update public.orcamentos
   set codigo = 'PEV-0007/26-' || right(codigo, 2)
 where codigo like '0-0001/26-%';

-- Projetos do financeiro, do mesmo cliente e com a mesma sigla.
update public.projetos_financeiro set codigo = 'PEV-0001/26' where codigo = 'PEVETE-0001/26';
update public.projetos_financeiro set codigo = 'PEV-0003/26' where codigo = 'PEVETE-0003/26';
update public.projetos_financeiro set codigo = 'PEV-0004/26' where codigo = 'PEVETE-0004/26';
update public.projetos_financeiro set codigo = 'PEV-0006/26' where codigo = 'PEVETE-0006/26';

-- ---------------------------------------------------------------- Teste
update public.clientes
   set codigo_curto = 'TES'
 where id = 'b32075ad-e6d0-4f13-aea9-af227937a4cb'
   and codigo_curto = 'TESTE';

-- ---------------------------------------------------------------- Teste 22
update public.clientes
   set codigo_curto = 'TET'
 where id = '93afec64-7347-455d-b057-e018627a29f4'
   and codigo_curto = 'teste22';

update public.projetos set codigo = 'TET-0001/26' where codigo = 'teste22-0001/26';
update public.orcamentos set codigo = 'TET-0001/26-01' where codigo = 'teste22-0001/26-01';
update public.projetos_financeiro set codigo = 'TET-0001/26' where codigo = 'teste22-0001/26';

commit;
