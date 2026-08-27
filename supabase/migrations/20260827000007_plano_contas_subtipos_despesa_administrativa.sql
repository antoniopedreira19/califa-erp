-- Cadastro dos subtipos de "Despesa Administrativa" (tipo 07) do tenant
-- Agência California. Segue a ordem definida pelo usuário. Idempotente via
-- unique (tenant, tipo, nome).
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '001', 'Alimentação'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '002', 'Correio'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '003', 'Eventos'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '004', 'Frete'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '005', 'Hospedagem'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '006', 'Manutenção e Conserto de Equipamentos'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '007', 'Material escritório'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '008', 'Motoboy'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '009', 'Outros'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '010', 'Passagem'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '5a8b2574-ee00-4f3e-8ebb-9fdc4899498f', '011', 'Tarifas')
on conflict (tenant_id, tipo_id, nome) do nothing;
