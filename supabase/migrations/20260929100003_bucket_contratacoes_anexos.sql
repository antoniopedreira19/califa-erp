-- =====================================================================
-- RH — bucket privado pros anexos de contratação
-- =====================================================================
--
-- Task 007. Guarda o PDF gerado pelo sistema (contrato preenchido pelo
-- template) e o PDF assinado que volta da ZapSign.
--
-- Path convention: {tenant_id}/{contratacao_id}/arquivo.pdf
--   - contrato-gerado.pdf
--   - contrato-assinado.pdf
--
-- Acesso via RLS: só admin/rh do tenant do path leem/escrevem. Delete
-- é admin only. Anon nunca toca.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('contratacoes-anexos', 'contratacoes-anexos', false)
on conflict (id) do nothing;

create policy contratacoes_anexos_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'contratacoes-anexos'
    and (
      is_tenant_admin((storage.foldername(name))[1]::uuid)
      or is_tenant_rh((storage.foldername(name))[1]::uuid)
    )
  );

create policy contratacoes_anexos_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'contratacoes-anexos'
    and (
      is_tenant_admin((storage.foldername(name))[1]::uuid)
      or is_tenant_rh((storage.foldername(name))[1]::uuid)
    )
  );

create policy contratacoes_anexos_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'contratacoes-anexos'
    and (
      is_tenant_admin((storage.foldername(name))[1]::uuid)
      or is_tenant_rh((storage.foldername(name))[1]::uuid)
    )
  );

create policy contratacoes_anexos_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'contratacoes-anexos'
    and is_tenant_admin((storage.foldername(name))[1]::uuid)
  );
