-- O reenvio de PP rejeitada nunca conseguiu salvar.
--
-- O reenvio REGERA o PDF e sobrescreve o anterior no mesmo path — e no
-- Storage do Supabase, `upsert` sobre objeto que ja existe e um UPDATE em
-- storage.objects, nao um INSERT. O bucket `pedidos-compra` nasceu com
-- policy de INSERT, SELECT e DELETE e nenhuma de UPDATE, entao o upload
-- morria em "new row violates row-level security policy" e a action
-- abortava ANTES de gravar a correcao.
--
-- Aditiva: policy nova, com exatamente o mesmo predicado das irmas — o
-- primeiro segmento do path e o tenant_id, e so membro daquele tenant
-- alcanca o arquivo. `with check` repete o `using` para que a regra valha
-- tambem para a linha resultante, impedindo mover arquivo entre tenants.

drop policy if exists pp_storage_update on storage.objects;
create policy pp_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and is_tenant_member((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'pedidos-compra'
    and is_tenant_member((split_part(name, '/', 1))::uuid)
  );
