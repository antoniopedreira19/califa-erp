-- Apaga o cliente de rascunho "Novo" (`NOO`), autorizado pelo Tiago.
--
-- Ele era um cadastro sem CNPJ, com o nome literalmente "Novo", e foi a
-- origem das três correções da decisão 092 §5c–5e: o "Beats Esquenta
-- Festivals" era dele, o `NOV-0004/26` do SEBRAE nasceu sob ele, e a
-- "Operação HitLab 2026" ficou metade dele, metade do HITLAB. Com os três
-- projetos nos clientes certos, sobrou vazio.
--
-- Conferido imediatamente antes, uma tabela por vez: 0 projetos, 0
-- projetos_financeiro, 0 portais, 0 contas avulsas, 0 recorrentes, 0
-- desembolsos, 0 faturamentos, 0 lançamentos. Restava só a marca padrão,
-- que nasce junto de todo cliente pelo `trg_clientes_marca_padrao`. A
-- única FK que aponta para `cliente_produtos` é `projetos.produto_id`, e
-- ele não tem projeto.
--
-- Mesmo cuidado da `20260918180001`: a FK de `cliente_produtos` é
-- RESTRICT e a marca padrão é protegida por `trg_cliente_produtos_padrao`,
-- que recusa qualquer DELETE dela. A trigger é desligada e religada
-- DENTRO desta transação — se algum passo falhar, o rollback devolve a
-- proteção.

begin;

alter table public.cliente_produtos disable trigger trg_cliente_produtos_padrao;

delete from public.cliente_produtos
where cliente_id = '684519a2-cc50-4667-9e90-d08afc3af4f9';

alter table public.cliente_produtos enable trigger trg_cliente_produtos_padrao;

delete from public.clientes
where id = '684519a2-cc50-4667-9e90-d08afc3af4f9'
  and codigo_curto = 'NOO';

commit;
