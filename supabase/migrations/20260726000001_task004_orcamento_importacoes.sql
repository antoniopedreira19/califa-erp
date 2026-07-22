-- =====================================================================
-- Task 004 fase F — Importação de planilha de orçamento
--
-- Escopo:
--   - Tabela public.orcamento_importacoes: uma linha por upload feito
--     por um GP. Aponta para a versão criada a partir do arquivo.
--   - Bucket privado 'orcamento-importacoes' para guardar o XLSX
--     original. Path: <tenant_id>/<orcamento_id>/<importacao_id>-<nome>.xlsx
--   - RLS + policies em storage.objects para isolar por tenant.
--   - GRANTs para authenticated (service_role já é coberto pelo
--     ALTER DEFAULT PRIVILEGES da migration 20260725000001).
--
-- Estratégia do fluxo (implementado em Server Actions):
--   1. Client seleciona arquivo → preview (parse sem persistir).
--   2. Confirma → upload no bucket + insert em orcamento_importacoes +
--      criação de versão em rascunho com grupos/itens.
-- =====================================================================

-- 1. Tabela orcamento_importacoes
create table if not exists public.orcamento_importacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  -- Versão gerada pela importação. Nullable para permitir INSERT com
  -- versao_orcamento_id preenchido em passo posterior (ver server action).
  versao_orcamento_id uuid references public.versoes_orcamento(id) on delete set null,
  arquivo_path text not null,             -- path completo no bucket
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes integer not null,
  aba_origem text,                        -- ex: 'Oficial'
  linhas_lidas integer not null default 0,
  linhas_importadas integer not null default 0,
  linhas_ignoradas integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint importacoes_arquivo_nao_vazio check (length(trim(arquivo_path)) > 0),
  constraint importacoes_tamanho_positivo check (arquivo_tamanho_bytes >= 0)
);

create index if not exists idx_importacoes_tenant on public.orcamento_importacoes(tenant_id);
create index if not exists idx_importacoes_orcamento on public.orcamento_importacoes(orcamento_id);
create index if not exists idx_importacoes_versao on public.orcamento_importacoes(versao_orcamento_id);
create index if not exists idx_importacoes_created_at on public.orcamento_importacoes(created_at desc);

-- 2. RLS orcamento_importacoes
alter table public.orcamento_importacoes enable row level security;

drop policy if exists importacoes_select on public.orcamento_importacoes;
create policy importacoes_select on public.orcamento_importacoes
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists importacoes_insert on public.orcamento_importacoes;
create policy importacoes_insert on public.orcamento_importacoes
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists importacoes_update on public.orcamento_importacoes;
create policy importacoes_update on public.orcamento_importacoes
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

-- Sem policy de delete: registro de auditoria; se precisar limpar, service_role.

-- 3. GRANTs para authenticated. service_role é coberto pelo
--    ALTER DEFAULT PRIVILEGES da migration 20260725000001.
grant select, insert, update on public.orcamento_importacoes to authenticated;

-- 4. Bucket de storage.
--    Privado (public=false). Server Actions usam service_role para
--    upload; RLS em storage.objects (abaixo) libera leitura apenas para
--    members do tenant dono do arquivo (path prefix = tenant_id).
insert into storage.buckets (id, name, public)
values ('orcamento-importacoes', 'orcamento-importacoes', false)
on conflict (id) do nothing;

-- 5. Policies em storage.objects para o bucket.
--    Path convention: <tenant_id>/<orcamento_id>/<importacao_id>-<nome>.xlsx
--    A primeira "pasta" (split por /) é o tenant_id.

drop policy if exists importacoes_storage_select on storage.objects;
create policy importacoes_storage_select on storage.objects
for select
to authenticated
using (
  bucket_id = 'orcamento-importacoes'
  and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
);

-- Server Actions usam service_role para insert; deixamos policy de
-- insert também para o dia em que quisermos upload direto do client.
drop policy if exists importacoes_storage_insert on storage.objects;
create policy importacoes_storage_insert on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'orcamento-importacoes'
  and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
);

-- Sem policies de update/delete — objetos ficam imutáveis (auditoria).
