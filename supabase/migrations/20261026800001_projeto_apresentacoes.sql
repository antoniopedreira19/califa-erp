-- =====================================================================
-- As apresentações do projeto (decisão 213, Tiago, 23–26/10/2026)
-- ---------------------------------------------------------------------
-- O formulário do projeto ganha o campo "Apresentação": os arquivos que
-- foram mostrados ao cliente (PDF, PowerPoint ou Keynote, até 50 MB cada),
-- quantos forem. Eles aparecem no card PROJETO da aba "Informações do Job"
-- de cada job do projeto, e abrem numa aba nova.
--
-- 1) `projeto_apresentacoes`: uma linha por arquivo, com o caminho no
--    bucket. Apagar a linha tira o arquivo do projeto.
-- 2) Bucket privado `projetos-apresentacoes`, caminho
--    `<tenant>/<uuid>-<nome>` (o arquivo sobe antes de o projeto novo
--    existir; o vínculo com o projeto é a linha). As policies usam
--    `tenant_do_caminho_no_storage` (decisão 190, 19/10): pasta que não é
--    uuid de tenant não derruba a listagem do bucket.
--
-- Mudança aditiva: tabela nova, bucket novo e policies novas.
-- =====================================================================

create table if not exists public.projeto_apresentacoes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  projeto_id    uuid not null references public.projetos(id) on delete cascade,
  nome_arquivo  text not null check (length(btrim(nome_arquivo)) between 1 and 255),
  storage_path  text not null unique,
  tamanho_bytes bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 52428800),
  tipo          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_projeto_apresentacoes_projeto
  on public.projeto_apresentacoes(projeto_id, created_at);
create index if not exists idx_projeto_apresentacoes_tenant
  on public.projeto_apresentacoes(tenant_id);

alter table public.projeto_apresentacoes enable row level security;

drop policy if exists projeto_apresentacoes_select on public.projeto_apresentacoes;
create policy projeto_apresentacoes_select on public.projeto_apresentacoes
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists projeto_apresentacoes_insert on public.projeto_apresentacoes;
create policy projeto_apresentacoes_insert on public.projeto_apresentacoes
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id) and created_by = (select auth.uid()));

drop policy if exists projeto_apresentacoes_delete on public.projeto_apresentacoes;
create policy projeto_apresentacoes_delete on public.projeto_apresentacoes
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.projeto_apresentacoes from anon;
grant select, insert, delete on public.projeto_apresentacoes to authenticated;

-- Projeto arquivado é só leitura (decisão 118), como os outros vínculos.
drop trigger if exists trg_projeto_apresentacoes_guarda_arquivado on public.projeto_apresentacoes;
create trigger trg_projeto_apresentacoes_guarda_arquivado
  before insert or update or delete on public.projeto_apresentacoes
  for each row execute function public.projeto_vinculo_guarda_arquivado();

comment on table public.projeto_apresentacoes is
  'Apresentações do projeto mostradas ao cliente (decisão 213): uma linha por arquivo do bucket projetos-apresentacoes.';

-- ---------------------------------------------------------------------
-- O bucket. Sem lista de tipos no bucket: o Keynote chega com tipos
-- diferentes conforme o navegador; a extensão é conferida no servidor.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('projetos-apresentacoes', 'projetos-apresentacoes', false, 52428800)
on conflict (id) do nothing;

drop policy if exists projetos_apresentacoes_storage_select on storage.objects;
create policy projetos_apresentacoes_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'projetos-apresentacoes'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

drop policy if exists projetos_apresentacoes_storage_insert on storage.objects;
create policy projetos_apresentacoes_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'projetos-apresentacoes'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

drop policy if exists projetos_apresentacoes_storage_delete on storage.objects;
create policy projetos_apresentacoes_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'projetos-apresentacoes'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );
