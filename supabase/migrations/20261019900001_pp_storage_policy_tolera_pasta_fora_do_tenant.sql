-- As policies do bucket `pedidos-compra` deixam de quebrar com pasta que não é tenant.
--
-- O que aconteceu (19/10/2026): o retroativo do selo da decisão 190 guardou
-- uma cópia dos 112 PDFs originais em `pedidos-compra/_antes-da-decisao-190/`
-- (12h43–12h45 de Brasília). As quatro policies do bucket faziam
-- `split_part(name, '/', 1)::uuid` direto. Numa listagem (`storage.list`), o
-- Postgres avalia a policy em TODAS as linhas do bucket antes do filtro de
-- prefixo (a policy é security barrier e o `like` do prefixo não é
-- leakproof), então o cast de "_antes-da-decisao-190" estourava:
--   invalid input syntax for type uuid: "_antes-da-decisao-190"
-- Gerar PP, "Salvar" a PP a emitir e a prévia do PDF listam a pasta da PP
-- para conferir os anexos e pararam para todo mundo. A última PP gerada antes
-- disso foi às 12h30.
--
-- A correção: o cast só acontece quando o primeiro segmento tem formato de
-- uuid. `case` garante a ordem de avaliação (um `and` não garante: o
-- planejador pode reordenar). Qualquer outra pasta na raiz do bucket vira
-- "sem acesso" para `authenticated` em vez de erro; o `service_role` não
-- passa por RLS e segue lendo as cópias.
--
-- Para os arquivos que já existiam o acesso é o mesmo: todos ficam em
-- `<tenant_id>/...`.

create or replace function public.tenant_do_caminho_no_storage(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1)
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

comment on function public.tenant_do_caminho_no_storage(text) is
  'Primeiro segmento do caminho no Storage como uuid do tenant, ou NULL quando a pasta não é um tenant (ex.: _antes-da-decisao-190). Evita o erro de cast nas policies durante uma listagem.';

revoke all on function public.tenant_do_caminho_no_storage(text) from public, anon;
grant execute on function public.tenant_do_caminho_no_storage(text) to authenticated;

drop policy if exists pp_storage_select on storage.objects;
create policy pp_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

drop policy if exists pp_storage_insert on storage.objects;
create policy pp_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pedidos-compra'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

drop policy if exists pp_storage_update on storage.objects;
create policy pp_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  )
  with check (
    bucket_id = 'pedidos-compra'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

drop policy if exists pp_storage_delete on storage.objects;
create policy pp_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );
