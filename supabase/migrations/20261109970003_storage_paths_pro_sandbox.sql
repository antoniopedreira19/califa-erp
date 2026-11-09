-- ============================================================================
-- ATUALIZA COLUNAS DE PATH APÓS O MOVE DO STORAGE
-- ============================================================================
-- Rodar DEPOIS do script scripts/mover-storage-cluster-teste.ts ter movido
-- os blobs no Supabase Storage (COPY+DELETE server-side via API). As colunas
-- de path nas tabelas apontavam pro tenant_id antigo (prod); agora que os
-- blobs estão no caminho novo (sandbox), atualiza as colunas pro ponteiro
-- bater com a realidade física do Storage.
--
-- Filtra por tenant_id=sandbox + path LIKE 'prod_uuid/%' pra ser idempotente:
-- se as colunas já foram atualizadas por outra via, estes UPDATEs são no-op.
-- ============================================================================

set session_replication_role = replica;

do $$
declare
  v_tenant_prod    uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_tenant_sandbox uuid := 'db9278e5-1293-407f-bd33-d71b7061a849';
  v_prod_prefix    text := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c/';
  v_sand_prefix    text := 'db9278e5-1293-407f-bd33-d71b7061a849/';
  v_count          int;
begin

  update pedidos_compra_anexos
    set arquivo_path = v_sand_prefix || substring(arquivo_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and arquivo_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'pedidos_compra_anexos.arquivo_path: %', v_count;

  update pedidos_compra_a_emitir_anexos
    set arquivo_path = v_sand_prefix || substring(arquivo_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and arquivo_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'pedidos_compra_a_emitir_anexos.arquivo_path: %', v_count;

  update pedidos_compra
    set pdf_path = v_sand_prefix || substring(pdf_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and pdf_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'pedidos_compra.pdf_path: %', v_count;

  update pedidos_compra_parcelas
    set pdf_path = v_sand_prefix || substring(pdf_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and pdf_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'pedidos_compra_parcelas.pdf_path: %', v_count;

  update pp_verba_prestacoes_anexos
    set arquivo_path = v_sand_prefix || substring(arquivo_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and arquivo_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'pp_verba_prestacoes_anexos.arquivo_path: %', v_count;

  update jobs_envio_faturamento_anexos
    set path = v_sand_prefix || substring(path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'jobs_envio_faturamento_anexos.path: %', v_count;

  update faturamentos_po_anexos
    set path = v_sand_prefix || substring(path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'faturamentos_po_anexos.path: %', v_count;

  update contas_avulsas_anexos
    set arquivo_path = v_sand_prefix || substring(arquivo_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and arquivo_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'contas_avulsas_anexos.arquivo_path: %', v_count;

  update orcamento_importacoes
    set arquivo_path = v_sand_prefix || substring(arquivo_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and arquivo_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'orcamento_importacoes.arquivo_path: %', v_count;

  update desembolsos_anexos
    set arquivo_path = v_sand_prefix || substring(arquivo_path from length(v_prod_prefix)+1)
    where tenant_id = v_tenant_sandbox and arquivo_path like v_prod_prefix || '%';
  get diagnostics v_count = row_count;
  raise notice 'desembolsos_anexos.arquivo_path: %', v_count;

  raise notice 'OK: paths das tabelas apontam pro tenant sandbox';
end $$;

set session_replication_role = default;
