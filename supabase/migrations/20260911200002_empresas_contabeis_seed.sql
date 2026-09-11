-- =====================================================================
-- Seed inicial das 3 PJs contábeis do grupo California. Idempotente:
-- ON CONFLICT (tenant_id, cnpj) DO NOTHING. Se rodar em outro tenant no
-- futuro, ajustar o UUID.
-- =====================================================================

insert into public.empresas_contabeis
  (tenant_id, razao_social, nome_fantasia, cnpj, ativo)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
   'CALIFÓRNIA FILMES E PUBLICIDADE LTDA', 'California', '19437976000154', true),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
   'HITLAB PRODUÇÃO MUSICAL LTDA',        'Hitlab',     '04409741000181', true),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
   'GO CRAZY CONSULTORIA E MARKETING LTDA','GoCrazy',   '29943648000183', true)
on conflict (tenant_id, cnpj) do nothing;
