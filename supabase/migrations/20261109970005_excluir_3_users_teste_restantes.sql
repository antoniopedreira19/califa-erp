-- ============================================================================
-- EXCLUI 3 USERS @califa-erp.local QUE A 970004 NÃO PEGOU
-- ============================================================================
-- A migration 970004 só tratou os users que tinham referência em dados do
-- cluster movido (apareceram como responsavel_id, produtor_id, created_by,
-- etc.). Esses 3 outros users @califa-erp.local nunca foram autor de nada —
-- só tinham tenant_member em agencia-california e alguns empresa_members
-- cadastrados, sem usar.
--
-- Confirmado zero pegada em prod (jobs, orçamentos, PPs, avulsas, lançamentos,
-- freelancers, audit): podem sair direto sem re-aponte.
--
-- Users:
--   66e9058f-8ba3-4b65-ae0f-c968a76e1471  financeiro_teste@califa-erp.local
--   4a9bec5c-3e70-490c-8984-0846b6a0701d  freelancer_teste@califa-erp.local
--   17d0424a-6b26-4e2a-bb47-cf1e3597d69b  gp_teste@califa-erp.local
-- ============================================================================

set session_replication_role = replica;

do $$
declare
  v_ids uuid[] := ARRAY[
    '66e9058f-8ba3-4b65-ae0f-c968a76e1471',
    '4a9bec5c-3e70-490c-8984-0846b6a0701d',
    '17d0424a-6b26-4e2a-bb47-cf1e3597d69b'
  ]::uuid[];
  v_count int;
begin
  delete from empresa_members where user_id = any(v_ids);
  get diagnostics v_count = row_count;
  raise notice 'empresa_members deletados: %', v_count;

  delete from tenant_members where user_id = any(v_ids);
  get diagnostics v_count = row_count;
  raise notice 'tenant_members deletados: %', v_count;

  delete from profiles where id = any(v_ids);
  get diagnostics v_count = row_count;
  raise notice 'profiles deletados: %', v_count;

  delete from auth.users where id = any(v_ids);
  get diagnostics v_count = row_count;
  raise notice 'auth.users deletados: %', v_count;

  if exists (select 1 from profiles where email like '%califa-erp.local') then
    raise exception 'ainda existe profile @califa-erp.local';
  end if;
end $$;

set session_replication_role = default;
