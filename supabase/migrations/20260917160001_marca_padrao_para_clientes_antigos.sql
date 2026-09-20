-- Backfill: todo cliente passa a ter a marca padrão (PRD-01).
--
-- 17/09/2026. O campo Marca do formulário de projeto é obrigatório e só
-- lista as marcas do cliente escolhido. Desde 09/09/2026 o cadastro de
-- cliente cria a marca padrão junto (`criarCliente`, PRD-01 com o nome
-- fantasia), mas os clientes anteriores a isso ficaram sem nenhuma: eram
-- 150 dos 157 ativos quando esta migration foi escrita. Na prática,
-- escolher quase qualquer cliente no projeto caía em "Nenhuma marca
-- cadastrada" e travava ali.
--
-- Regra do Tiago (17/09/2026): "todo cliente deve ser cadastrado com uma
-- marca padrão". Este arquivo conserta o passado; o
-- `20260917160002_marca_padrao_nasce_com_o_cliente.sql` garante o futuro.
--
-- Aditiva: só preenche o que estava vazio. Não toca em cliente que já
-- tem marca, nem renomeia nada. Rodar de novo não duplica (o NOT EXISTS
-- barra), então é segura para reaplicar.

insert into cliente_produtos (tenant_id, cliente_id, nome, codigo, padrao, ativo)
select
  c.tenant_id,
  c.id,
  c.nome_fantasia,
  'PRD-01',
  true,
  true
from clientes c
where not exists (
  select 1 from cliente_produtos p where p.cliente_id = c.id
);

-- `created_by` fica nulo de propósito: não foi uma pessoa que cadastrou
-- esta marca, foi o backfill. A coluna é anulável e o FK é ON DELETE SET
-- NULL, então nulo já é um valor previsto ali.
