-- Cadastro dos subtipos de "Despesa Comercial" (tipo 08) do tenant
-- Agência California. Segue a ordem definida pelo usuário. Idempotente
-- via unique (tenant, tipo, nome).
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '001', 'Alimentação'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '002', 'Estacionamento'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '003', 'Gasolina'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '004', 'Hospedagem'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '005', 'Mídia'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '006', 'Outros'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '007', 'Passagem'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '008', 'Relacionamento com cliente'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '53a29e89-d7d4-4be0-923a-6fe9c883b868', '009', 'Transporte')
on conflict (tenant_id, tipo_id, nome) do nothing;
