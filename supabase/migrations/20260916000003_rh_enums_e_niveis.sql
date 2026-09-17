-- =====================================================================
-- RH — Fase 2: enum tipo_contratacao + tabela niveis
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Nasce o catálogo de níveis de cargo (hierarquia de senioridade — N3,
-- N4, N5, extensível) e o enum `tipo_contratacao` que a tabela
-- `colaboradores` vai usar na próxima migration (Fase 3). Estão juntos
-- neste arquivo porque são a "gramática" do RH — o vocabulário fixo que
-- todas as tabelas seguintes vão referenciar.
--
-- Dependências:
--   • public.tenants                — já existe (Task 001)
--   • public.profiles               — já existe (Task 001, referência de `created_by`)
--   • public.is_tenant_admin(uuid)  — já existe (Task 001)
--   • public.is_tenant_rh(uuid)     — criado em 20260916000002
--   • public.set_updated_at()       — trigger function já existe no projeto
--
-- Decisões (ver docs/modulos/rh/03-modelo-de-dados.md):
--   • Nível é HIERARQUIA DE CARGO, não faixa salarial. Sem coluna de
--     valor mínimo/máximo. Só codigo, descricao e ordem.
--   • Nível usa `ativo boolean` (não `cadastro_status` enum) porque é
--     catálogo estrutural pequeno — padrão de `regionais`, `categorias`,
--     `plano_contas_*`.
--   • RLS restrita a admin OR rh — dado sensível, gate role-específico.
--   • Sem DELETE policy — soft-delete via `ativo=false`.
--   • Seed: N3, N4, N5 (ordens 3, 4, 5) — os únicos que aparecem na
--     planilha atual da California. Novos níveis são criados pela UI.
--     `created_by` do seed fica NULL — a inserção é da migration, não de
--     um usuário.
--
-- Aditivo do começo ao fim: nenhum DROP, nenhuma linha existente é
-- tocada. O `on conflict do nothing` no seed torna a migration
-- idempotente para tenants adicionais que venham a existir.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Enum tipo_contratacao
-- ---------------------------------------------------------------------
--
-- 5 valores fixos que cobrem 100% da planilha de colaboradores da
-- California (fotografia de 2026-09-16):
--   pj          — Pessoa Jurídica que emite NF (~70% do quadro)
--   mei         — Microempreendedor Individual (emite NF simplificada)
--   clt_recibo  — Contratação híbrida (contrato CLT + recibos separados)
--   clt         — Consolidação das Leis do Trabalho
--   estagio     — Estagiário via TCE
--
-- Regra de negócio derivada (aplicada no CHECK de colaboradores.cpf_cnpj
-- na Fase 3):
--   pj, mei, clt_recibo → CNPJ (14 dígitos)
--   clt, estagio        → CPF  (11 dígitos)

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_contratacao') then
    create type public.tipo_contratacao as enum (
      'pj',
      'mei',
      'clt_recibo',
      'clt',
      'estagio'
    );
  end if;
end$$;


-- ---------------------------------------------------------------------
-- 2. Tabela niveis
-- ---------------------------------------------------------------------

create table if not exists public.niveis (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  codigo      text not null,
  descricao   text,
  ordem       smallint,
  ativo       boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_niveis_codigo_nao_vazio check (length(trim(codigo)) >= 1),
  constraint chk_niveis_ordem_positiva   check (ordem is null or ordem > 0)
);

comment on table public.niveis is
  'Catalogo tenant-wide de niveis de cargo (hierarquia de senioridade). NAO representa faixa salarial. Referenciado por colaboradores.nivel_id (Fase 3).';
comment on column public.niveis.codigo is
  'Codigo curto (N3, N4, N5, N1, N2, N6...). Unico por tenant, case-insensitive.';
comment on column public.niveis.ordem is
  'Opcional. Usado pra ordenar niveis na UI (N3 < N4 < N5). NULL = sem ordem definida.';


-- ---------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------

create unique index if not exists uniq_niveis_codigo_por_tenant
  on public.niveis (tenant_id, upper(codigo));

create index if not exists idx_niveis_tenant
  on public.niveis (tenant_id);

create index if not exists idx_niveis_ativo
  on public.niveis (tenant_id) where ativo = true;


-- ---------------------------------------------------------------------
-- 4. Trigger updated_at
-- ---------------------------------------------------------------------

drop trigger if exists trg_niveis_updated_at on public.niveis;
create trigger trg_niveis_updated_at
  before update on public.niveis
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 5. RLS + policies
-- ---------------------------------------------------------------------
--
-- Gate role-específico do módulo RH: só administrador OU rh.
-- Sem policy DELETE — soft-delete via ativo=false.

alter table public.niveis enable row level security;

drop policy if exists niveis_select on public.niveis;
create policy niveis_select on public.niveis
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists niveis_insert on public.niveis;
create policy niveis_insert on public.niveis
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists niveis_update on public.niveis;
create policy niveis_update on public.niveis
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));


-- ---------------------------------------------------------------------
-- 6. GRANT
-- ---------------------------------------------------------------------

grant select, insert, update on public.niveis to authenticated;


-- ---------------------------------------------------------------------
-- 7. Seed inicial — N3, N4, N5 no tenant Agência California
-- ---------------------------------------------------------------------
--
-- Os únicos níveis que aparecem na planilha atual (fotografia
-- 2026-09-16). Novos níveis são criados pela UI de /cadastros/niveis.
-- Idempotente via unique index em (tenant_id, upper(codigo)).

insert into public.niveis (tenant_id, codigo, descricao, ordem, ativo)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'N3', 'Nivel 3', 3, true),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'N4', 'Nivel 4', 4, true),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'N5', 'Nivel 5', 5, true)
on conflict (tenant_id, upper(codigo)) do nothing;
