-- Cadastro dos subtipos de "Despesa com Pessoal" (tipo 05) do tenant
-- Agência California. Salário (001) já existia; adiciona os demais na
-- ordem definida pelo usuário. Idempotente via unique (tenant, tipo, nome).
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '002', 'Benefícios (plano de saúde e Total Pass)'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '003', 'Bonificação'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '004', '13° Salário'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '005', 'Estagiário'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '006', 'Férias'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '007', 'FGTS'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '008', 'INSS'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '009', 'IR Retido'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '010', 'Outros'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '011', 'ProLabore'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '012', 'Processo trabalhista'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '013', 'Rescisão'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '59450120-46df-4437-90aa-fa9b30a88fed', '014', 'Transporte')
on conflict (tenant_id, tipo_id, nome) do nothing;
