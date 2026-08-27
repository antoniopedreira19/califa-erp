-- Cadastro dos subtipos de "Custo Fixo" (tipo 04) do tenant Agência
-- California. Aluguel/Condomínio/IPTU (001) já existia; adiciona os
-- demais na ordem definida pelo usuário. Idempotente via unique
-- (tenant, tipo, nome).
insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '002', 'Advogado'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '003', 'Água'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '004', 'Assinaturas'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '005', 'Celular'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '006', 'Contabilidade'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '007', 'Energia'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '008', 'Internet / Telefone'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '009', 'Material Limpeza'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '010', 'Outros'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '011', 'Sistema'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', '404a7e89-e7f0-46ce-8583-2ec20e26ce02', '012', 'Tarifa bancária')
on conflict (tenant_id, tipo_id, nome) do nothing;
