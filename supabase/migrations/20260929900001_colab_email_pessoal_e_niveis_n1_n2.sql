-- Duas mudanças aditivas pra suportar a reconciliação com o CSV
-- atualizado do RH (29/09/2026):
--
-- 1. colaboradores.email_pessoal — o CSV traz dois emails ("California"
--    e "Pessoal"), e o cadastro atual só tem `email`. Vira coluna nova
--    opcional pra guardar o pessoal ao lado do corporativo.
--
-- 2. niveis N1 e N2 — o CSV usa N1 pros CEOs (Bruno Duarte, Fabio
--    Duarte) e N2 pros diretores (Berber, Icaro, Perazzo, Alvarez,
--    Kikote, Bruno Buck, Wilson Brandao). O banco só tinha N3, N4 e
--    N5. Sem esses dois o mapeamento de nivel_id fica null pra ~9
--    colaboradores.
--
-- Nada destrutivo: colunas e linhas novas, sem tocar em dado existente.

alter table colaboradores
  add column if not exists email_pessoal text;

insert into niveis (tenant_id, codigo, descricao, ativo)
select 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'N1', 'Nivel 1', true
where not exists (
  select 1 from niveis
  where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
    and codigo = 'N1'
);

insert into niveis (tenant_id, codigo, descricao, ativo)
select 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'N2', 'Nivel 2', true
where not exists (
  select 1 from niveis
  where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
    and codigo = 'N2'
);
