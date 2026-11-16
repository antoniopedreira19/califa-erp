-- Migration: 20261116800002_colaborador_dono_pode_anexar_nf.sql
--
-- Em 21/10/2026 a migration 20261021000005_fechar_rls_freelancers_e_buckets.sql
-- fechou RLS da tabela `colaboradores_nf_anexos` e do bucket `colaboradores-nf`
-- para apenas admin+rh+financeiro, como resposta a vazamento de dado pessoal
-- (ADR 203). Na data, o comentário da migration dizia: "A role freelancer hoje
-- nao acessa nenhuma dessas telas pela UI (grep confirmou), entao o fechamento
-- nao quebra funcionalidade existente."
--
-- Em 26/10/2026 veio o Quadro de NFs no /perfil, onde o próprio colaborador
-- anexa a NF dele mesmo (card "Quadro de NFs" com botão "Anexar NF"). O
-- fechamento de 21/10 nunca foi reajustado — resultado: um colaborador PJ
-- clica "Anexar NF" e recebe "Falha ao subir arquivo: new row violates
-- row-level security policy" no bucket, porque nf_bucket_insert bloqueia
-- quem não é admin/rh/financeiro.
--
-- Esta migration reabre a porta APENAS para o colaborador DONO do escopo,
-- sem reintroduzir o vazamento: um colaborador só enxerga/mexe no anexo cujo
-- colaborador_id está vinculado ao user_id dele. Nenhum colaborador vê
-- anexo de outro.
--
-- Mudança aditiva (adiciona cláusula OR nas policies existentes).
-- Nenhuma coluna, nenhuma tabela, nenhum dado é alterado.

-- ============================================================
-- Tabela: public.colaboradores_nf_anexos
-- ============================================================

-- SELECT: dono pode ver o próprio anexo.
drop policy if exists nf_anexos_select on public.colaboradores_nf_anexos;
create policy nf_anexos_select on public.colaboradores_nf_anexos
  for select to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
    or colaborador_id in (
      select id from public.colaboradores
      where user_id = (select auth.uid())
        and tenant_id = colaboradores_nf_anexos.tenant_id
    )
  );

-- INSERT: dono pode anexar a própria NF.
drop policy if exists nf_anexos_insert on public.colaboradores_nf_anexos;
create policy nf_anexos_insert on public.colaboradores_nf_anexos
  for insert to authenticated
  with check (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
    or colaborador_id in (
      select id from public.colaboradores
      where user_id = (select auth.uid())
        and tenant_id = colaboradores_nf_anexos.tenant_id
    )
  );

-- UPDATE: dono pode substituir a própria NF (idempotência do upload).
drop policy if exists nf_anexos_update on public.colaboradores_nf_anexos;
create policy nf_anexos_update on public.colaboradores_nf_anexos
  for update to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
    or colaborador_id in (
      select id from public.colaboradores
      where user_id = (select auth.uid())
        and tenant_id = colaboradores_nf_anexos.tenant_id
    )
  )
  with check (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
    or colaborador_id in (
      select id from public.colaboradores
      where user_id = (select auth.uid())
        and tenant_id = colaboradores_nf_anexos.tenant_id
    )
  );

-- DELETE: dono pode remover a própria NF.
drop policy if exists nf_anexos_delete on public.colaboradores_nf_anexos;
create policy nf_anexos_delete on public.colaboradores_nf_anexos
  for delete to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
    or colaborador_id in (
      select id from public.colaboradores
      where user_id = (select auth.uid())
        and tenant_id = colaboradores_nf_anexos.tenant_id
    )
  );

-- ============================================================
-- Storage: bucket colaboradores-nf
-- Convenção do path: `tenant_id/colaborador_id/escopo_tipo/escopo_id.pdf`
--   - split_part(name,'/',1) = tenant_id
--   - split_part(name,'/',2) = colaborador_id
-- ============================================================

drop policy if exists nf_bucket_select on storage.objects;
create policy nf_bucket_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
      or exists (
        select 1 from public.colaboradores c
        where c.id = (split_part(name, '/', 2))::uuid
          and c.tenant_id = (split_part(name, '/', 1))::uuid
          and c.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists nf_bucket_insert on storage.objects;
create policy nf_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
      or exists (
        select 1 from public.colaboradores c
        where c.id = (split_part(name, '/', 2))::uuid
          and c.tenant_id = (split_part(name, '/', 1))::uuid
          and c.user_id = (select auth.uid())
      )
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
      or exists (
        select 1 from public.colaboradores c
        where c.id = (split_part(name, '/', 2))::uuid
          and c.tenant_id = (split_part(name, '/', 1))::uuid
          and c.user_id = (select auth.uid())
      )
    )
  )
  with check (
    bucket_id = 'colaboradores-nf'
    and (
      is_tenant_admin((split_part(name, '/', 1))::uuid)
      or is_tenant_rh((split_part(name, '/', 1))::uuid)
      or is_tenant_financeiro((split_part(name, '/', 1))::uuid)
      or exists (
        select 1 from public.colaboradores c
        where c.id = (split_part(name, '/', 2))::uuid
          and c.tenant_id = (split_part(name, '/', 1))::uuid
          and c.user_id = (select auth.uid())
      )
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
      or exists (
        select 1 from public.colaboradores c
        where c.id = (split_part(name, '/', 2))::uuid
          and c.tenant_id = (split_part(name, '/', 1))::uuid
          and c.user_id = (select auth.uid())
      )
    )
  );
