-- =====================================================================
-- Projeto: Regional e Responsável passam a ser múltiplos + Produto
--
-- Origem: revisão da tela "Projetos & Orçamentos" (06/08/2026).
--
-- 1) Regional e Responsável viram N:N. As colunas `projetos.regional_id`
--    e `projetos.responsavel_id` CONTINUAM existindo e sincronizadas com
--    o primeiro item selecionado — `responsavel_id` é NOT NULL e há
--    leitores fora deste fluxo. As tabelas de vínculo são a fonte-verdade
--    da UI; as colunas são compatibilidade.
--
-- 2) `produto_id` aponta para `cliente_produtos`, que tem escopo CLIENTE.
--    O banco não consegue garantir sozinho que o produto pertence ao
--    cliente do projeto (exigiria FK composta e coluna redundante); a
--    checagem vive na server action, como já acontece na abertura de job.
--    Nullable no banco: há projetos anteriores a esta mudança. A
--    obrigatoriedade fica no Zod.
--
-- 3) `projetos.cidade_id` sai do formulário (Cidade migra para o
--    orçamento) mas a coluna e os dados gravados permanecem.
-- =====================================================================

-- 1) projeto_regionais --------------------------------------------------
create table if not exists public.projeto_regionais (
  projeto_id  uuid not null references public.projetos(id) on delete cascade,
  regional_id uuid not null references public.regionais(id) on delete restrict,
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (projeto_id, regional_id)
);

create index if not exists idx_projeto_regionais_regional
  on public.projeto_regionais(regional_id);
create index if not exists idx_projeto_regionais_tenant
  on public.projeto_regionais(tenant_id);

alter table public.projeto_regionais enable row level security;

drop policy if exists projeto_regionais_select on public.projeto_regionais;
create policy projeto_regionais_select on public.projeto_regionais
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists projeto_regionais_insert on public.projeto_regionais;
create policy projeto_regionais_insert on public.projeto_regionais
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

-- DELETE existe aqui (diferente das tabelas de cadastro): editar o projeto
-- troca o conjunto de regionais, não inativa linha por linha.
drop policy if exists projeto_regionais_delete on public.projeto_regionais;
create policy projeto_regionais_delete on public.projeto_regionais
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, delete on public.projeto_regionais to authenticated;

-- 2) projeto_responsaveis -----------------------------------------------
create table if not exists public.projeto_responsaveis (
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (projeto_id, profile_id)
);

create index if not exists idx_projeto_responsaveis_profile
  on public.projeto_responsaveis(profile_id);
create index if not exists idx_projeto_responsaveis_tenant
  on public.projeto_responsaveis(tenant_id);

alter table public.projeto_responsaveis enable row level security;

drop policy if exists projeto_responsaveis_select on public.projeto_responsaveis;
create policy projeto_responsaveis_select on public.projeto_responsaveis
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists projeto_responsaveis_insert on public.projeto_responsaveis;
create policy projeto_responsaveis_insert on public.projeto_responsaveis
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists projeto_responsaveis_delete on public.projeto_responsaveis;
create policy projeto_responsaveis_delete on public.projeto_responsaveis
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, delete on public.projeto_responsaveis to authenticated;

-- 3) Backfill dos projetos existentes -----------------------------------
insert into public.projeto_regionais (projeto_id, regional_id, tenant_id)
select p.id, p.regional_id, p.tenant_id
  from public.projetos p
 where p.regional_id is not null
on conflict do nothing;

insert into public.projeto_responsaveis (projeto_id, profile_id, tenant_id)
select p.id, p.responsavel_id, p.tenant_id
  from public.projetos p
on conflict do nothing;

-- 4) projetos.produto_id ------------------------------------------------
alter table public.projetos
  add column if not exists produto_id uuid
  references public.cliente_produtos(id) on delete restrict;

create index if not exists idx_projetos_produto on public.projetos(produto_id);

comment on column public.projetos.produto_id is
  'Produto do cadastro do cliente. Herdado pelo job na abertura.';

comment on column public.projetos.regional_id is
  'Compatibilidade: primeira regional do projeto. Fonte-verdade é projeto_regionais.';

comment on column public.projetos.responsavel_id is
  'Compatibilidade: primeiro responsável do projeto. Fonte-verdade é projeto_responsaveis.';

comment on column public.projetos.cidade_id is
  'Legado: cidade saiu do formulário do projeto em 06/08/2026 e passou a ser informada no orçamento.';
