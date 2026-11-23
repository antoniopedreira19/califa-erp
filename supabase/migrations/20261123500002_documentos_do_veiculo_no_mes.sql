-- =====================================================================
-- Mídia Off, entrega 4 (decisão 274, 23/11/2026): AP, PI e a NF do
-- veículo, por veículo e mês do job.
-- ---------------------------------------------------------------------
-- Regras do Tiago (15/10 e 23/11/2026): a veiculação só acontece com AP e
-- PI, e os dois — com a NF do veículo — liberam o envio do mês ao
-- faturamento. A NF do A · Direto é a nota que o veículo emite ao cliente
-- (com número, data e valor); a do A · Repasse chega pela PP do repasse,
-- e não mora aqui.
--
-- 1) `jobs_midia_documentos`: um documento de cada tipo por veículo e mês
--    (`uq_jobs_midia_doc`). Trocar o arquivo regrava a linha; remover
--    apaga. Quem anexou e quando ficam na linha e na auditoria — a data é
--    o que a entrega 5 compara com a extensão da veiculação.
-- 2) Bucket privado `jobs-midia`, caminho `<tenant>/<job>/<uuid>-<nome>`.
--    Abrir: quem é do tenant. Anexar e apagar: administrador, GP e
--    produtor (Tiago, 23/11/2026, a mesma régua de `jobs.editar`). O
--    arquivo que uma linha ainda aponta não se apaga.
--
-- Mudança aditiva: tabela nova, bucket novo e policies novas.
-- =====================================================================

create table if not exists public.jobs_midia_documentos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  -- O veículo é um fornecedor (decisão 150).
  fornecedor_id uuid not null references public.fornecedores(id) on delete restrict,
  -- O mês da veiculação, sempre o dia 1.
  mes           date not null check (extract(day from mes) = 1),
  tipo          text not null check (tipo in ('ap', 'pi', 'nf')),
  numero        text not null check (length(btrim(numero)) between 1 and 60),
  -- Só a NF tem valor e data de emissão.
  valor         numeric(14,2) check (valor is null or valor > 0),
  data_emissao  date,
  nome_arquivo  text not null check (length(btrim(nome_arquivo)) between 1 and 255),
  storage_path  text not null unique,
  tamanho_bytes bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 26214400),
  tipo_arquivo  text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint chk_jobs_midia_doc_nf
    check (tipo <> 'nf' or (valor is not null and data_emissao is not null)),
  constraint chk_jobs_midia_doc_so_nf_tem_valor
    check (tipo = 'nf' or (valor is null and data_emissao is null))
);

create unique index if not exists uq_jobs_midia_doc
  on public.jobs_midia_documentos(job_id, fornecedor_id, mes, tipo);
create index if not exists idx_jobs_midia_documentos_tenant
  on public.jobs_midia_documentos(tenant_id);
create index if not exists idx_jobs_midia_documentos_fornecedor
  on public.jobs_midia_documentos(fornecedor_id);

alter table public.jobs_midia_documentos enable row level security;

drop policy if exists jobs_midia_documentos_select on public.jobs_midia_documentos;
create policy jobs_midia_documentos_select on public.jobs_midia_documentos
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists jobs_midia_documentos_insert on public.jobs_midia_documentos;
create policy jobs_midia_documentos_insert on public.jobs_midia_documentos
  for insert to authenticated
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (select public.session_role()) = any (array['administrador', 'gerente_producao', 'produtor']::public.app_role[])
    and created_by = (select auth.uid())
  );

drop policy if exists jobs_midia_documentos_update on public.jobs_midia_documentos;
create policy jobs_midia_documentos_update on public.jobs_midia_documentos
  for update to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (select public.session_role()) = any (array['administrador', 'gerente_producao', 'produtor']::public.app_role[])
  )
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (select public.session_role()) = any (array['administrador', 'gerente_producao', 'produtor']::public.app_role[])
    and created_by = (select auth.uid())
  );

drop policy if exists jobs_midia_documentos_delete on public.jobs_midia_documentos;
create policy jobs_midia_documentos_delete on public.jobs_midia_documentos
  for delete to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (select public.session_role()) = any (array['administrador', 'gerente_producao', 'produtor']::public.app_role[])
  );

revoke all on public.jobs_midia_documentos from anon;
grant select, insert, update, delete on public.jobs_midia_documentos to authenticated;

comment on table public.jobs_midia_documentos is
  'Mídia Off (decisão 274): AP, PI e NF do veículo por veículo e mês do job; liberam o envio do mês ao faturamento. Arquivos no bucket jobs-midia.';

-- ---------------------------------------------------------------------
-- O bucket: PDF ou imagem, até 25 MB (a extensão é conferida no servidor).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('jobs-midia', 'jobs-midia', false, 26214400)
on conflict (id) do nothing;

drop policy if exists jobs_midia_storage_select on storage.objects;
create policy jobs_midia_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'jobs-midia'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

drop policy if exists jobs_midia_storage_insert on storage.objects;
create policy jobs_midia_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'jobs-midia'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (select public.session_role()) = any (array['administrador', 'gerente_producao', 'produtor']::public.app_role[])
  );

drop policy if exists jobs_midia_storage_delete on storage.objects;
create policy jobs_midia_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'jobs-midia'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (select public.session_role()) = any (array['administrador', 'gerente_producao', 'produtor']::public.app_role[])
    and not exists (
      select 1 from public.jobs_midia_documentos d where d.storage_path = objects.name
    )
  );
