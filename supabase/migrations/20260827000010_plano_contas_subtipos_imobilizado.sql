-- Cadastro dos subtipos de "Imobilizado" (tipo 13) do tenant Agência
-- California. Segue a ordem definida pelo usuário. Idempotente via
-- unique (tenant, tipo, nome).
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '54038802-e423-426d-88f0-5561b1a8e9ae', '001', 'Móveis / Ativos'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '54038802-e423-426d-88f0-5561b1a8e9ae', '002', 'Equipamentos'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '54038802-e423-426d-88f0-5561b1a8e9ae', '003', 'Ibira'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '54038802-e423-426d-88f0-5561b1a8e9ae', '004', 'Obra / Manutenção'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '54038802-e423-426d-88f0-5561b1a8e9ae', '005', 'TAIPE')
on conflict (tenant_id, tipo_id, nome) do nothing;
