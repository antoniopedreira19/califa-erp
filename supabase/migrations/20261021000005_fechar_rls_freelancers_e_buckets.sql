-- Fecha RLS de freelancers / freelancer_contratos / colaboradores_nf_anexos
-- e dos buckets freelancer-arquivos e colaboradores-nf.
--
-- Motivo: as policies de SELECT usavam is_tenant_member(tenant_id), que
-- resolve pra true pra qualquer tenant_member ativo, inclusive role freelancer
-- e role produtor. Isso vazava CPF+email+telefone+data_nascimento de 221
-- cadastros (210 com CPF) e permitia LIST de 738 arquivos do bucket pra
-- 92 usuarios (gerente_producao + produtor + freelancer) que nao deveriam ver.
--
-- Padrao correto (ja usado em colaboradores_salarios): dados pessoais sao
-- restritos a admin + rh + financeiro. A role freelancer hoje nao acessa
-- nenhuma dessas telas pela UI (grep confirmou), entao o fechamento nao
-- quebra funcionalidade existente.
--
-- Ver ADR 203 (criada junto com esta migration).

-- freelancers
drop policy if exists freelancers_select on public.freelancers;
create policy freelancers_select on public.freelancers
  for select to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

-- freelancer_contratos
drop policy if exists freelancer_contratos_select on public.freelancer_contratos;
create policy freelancer_contratos_select on public.freelancer_contratos
  for select to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

-- colaboradores_nf_anexos: as 4 operacoes passam a exigir admin+rh+financeiro
drop policy if exists nf_anexos_select on public.colaboradores_nf_anexos;
create policy nf_anexos_select on public.colaboradores_nf_anexos
  for select to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

drop policy if exists nf_anexos_insert on public.colaboradores_nf_anexos;
create policy nf_anexos_insert on public.colaboradores_nf_anexos
  for insert to authenticated
  with check (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

drop policy if exists nf_anexos_update on public.colaboradores_nf_anexos;
create policy nf_anexos_update on public.colaboradores_nf_anexos
  for update to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  )
  with check (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

drop policy if exists nf_anexos_delete on public.colaboradores_nf_anexos;
create policy nf_anexos_delete on public.colaboradores_nf_anexos
  for delete to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );

-- Storage: bucket freelancer-arquivos
-- Convencao do bucket: primeiro segmento do path = tenant_id uuid.
drop policy if exists freelancer_arquivos_select on storage.objects;
create policy freelancer_arquivos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'freelancer-arquivos'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  );

-- Storage: bucket colaboradores-nf (mesmo gap do SELECT)
drop policy if exists nf_bucket_select on storage.objects;
create policy nf_bucket_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  );

-- Simetria: INSERT/UPDATE/DELETE do bucket colaboradores-nf tambem passam
-- a exigir admin+rh+financeiro. Antes aceitavam qualquer tenant_member.
drop policy if exists nf_bucket_insert on storage.objects;
create policy nf_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  );

drop policy if exists nf_bucket_update on storage.objects;
create policy nf_bucket_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  )
  with check (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  );

drop policy if exists nf_bucket_delete on storage.objects;
create policy nf_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  );
