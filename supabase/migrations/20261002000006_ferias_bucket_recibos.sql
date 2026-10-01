-- Motivo: cria o bucket privado "recibos-ferias" no Supabase Storage para
-- armazenar os PDFs de recibo de férias/abono dos colaboradores PJ.
-- Policies: colaborador lê só seus próprios recibos (match pelo caminho
-- `<colaborador_id>/*`); RH e admin leem/escrevem tudo do tenant via rota
-- do server (service role).
--
-- Referências:
--   - docs/modulos/rh/25-ferias.md §7
--   - docs/modulos/rh/27-ferias-plano-de-execucao.md S7

insert into storage.buckets (id, name, public)
values ('recibos-ferias', 'recibos-ferias', false)
on conflict (id) do nothing;

drop policy if exists ferias_recibo_colab_read on storage.objects;
create policy ferias_recibo_colab_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recibos-ferias'
    and (storage.foldername(name))[1] in (
      select c.id::text
        from public.colaboradores c
       where c.user_id = (select auth.uid())
    )
  );

drop policy if exists ferias_recibo_rh_admin_all on storage.objects;
create policy ferias_recibo_rh_admin_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'recibos-ferias'
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = (select auth.uid())
         and tm.status = 'ativo'
         and tm.role in ('administrador', 'rh')
    )
  )
  with check (
    bucket_id = 'recibos-ferias'
    and exists (
      select 1 from public.tenant_members tm
       where tm.user_id = (select auth.uid())
         and tm.status = 'ativo'
         and tm.role in ('administrador', 'rh')
    )
  );
