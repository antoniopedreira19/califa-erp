-- =====================================================================
-- Cadastro de cidades + novos campos do projeto
--
-- Origem: handoff "Novo projeto.dc.html". O formulário de projeto passa
-- a pedir Regional, Cidade, Final previsto e Descrição.
--
-- `regional_id`, `cidade` e `data_fim_prevista` já existiam em `jobs`;
-- aqui eles sobem para o projeto. Diferença deliberada: em `jobs` cidade
-- é texto livre; no projeto vira FK para o cadastro novo, decidido com
-- o time em 30/07/2026 (padroniza o dado antes de crescer a base).
--
-- Obrigatoriedade (Regional, Cidade, Final previsto, Categoria) fica na
-- validação Zod, NÃO no banco: já existem projetos gravados e um NOT
-- NULL exigiria backfill. Decisão do time na mesma data.
-- =====================================================================

-- 1) tabela cidades -----------------------------------------------------
create table if not exists public.cidades (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  nome        text not null,
  ativo       boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cidades_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index if not exists uniq_cidade_por_tenant
  on public.cidades(tenant_id, lower(nome));

create index if not exists idx_cidades_tenant on public.cidades(tenant_id);
create index if not exists idx_cidades_ativo  on public.cidades(tenant_id, ativo);

drop trigger if exists trg_cidades_updated_at on public.cidades;
create trigger trg_cidades_updated_at
  before update on public.cidades
  for each row execute function public.set_updated_at();

alter table public.cidades enable row level security;

drop policy if exists cidades_select on public.cidades;
create policy cidades_select on public.cidades
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists cidades_insert on public.cidades;
create policy cidades_insert on public.cidades
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists cidades_update on public.cidades;
create policy cidades_update on public.cidades
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE (soft-delete via ativo=false), igual a regionais.
grant select, insert, update on public.cidades to authenticated;

-- 2) novos campos em projetos ------------------------------------------
alter table public.projetos
  add column if not exists regional_id uuid references public.regionais(id) on delete restrict;

alter table public.projetos
  add column if not exists cidade_id uuid references public.cidades(id) on delete restrict;

alter table public.projetos
  add column if not exists data_fim_prevista date;

alter table public.projetos
  add column if not exists descricao text;

create index if not exists idx_projetos_regional on public.projetos(regional_id);
create index if not exists idx_projetos_cidade   on public.projetos(cidade_id);

-- Regras que não podem depender só do formulário.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projetos_fim_apos_inicio'
  ) then
    alter table public.projetos
      add constraint projetos_fim_apos_inicio
      check (data_fim_prevista is null or data_fim_prevista >= data_inicio_prevista);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projetos_descricao_tamanho'
  ) then
    alter table public.projetos
      add constraint projetos_descricao_tamanho
      check (descricao is null or length(descricao) <= 600);
  end if;
end$$;

-- 3) Seed inicial de cidades -------------------------------------------
-- Só Salvador e São Paulo por ora; a carga completa entra em task futura.
insert into public.cidades (tenant_id, nome)
select t.id, v.nome
  from public.tenants t
 cross join (values
   ('Salvador'),
   ('São Paulo')
 ) as v(nome)
 where t.slug = 'agencia-california'
   and not exists (
     select 1 from public.cidades c
      where c.tenant_id = t.id and lower(c.nome) = lower(v.nome)
   );
