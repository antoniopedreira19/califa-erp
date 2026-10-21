-- Motivo: fundacao do modulo de 13o Salario — Parte 1.
-- Cria enum decimo_terceiro_folha_status e tabelas decimo_terceiro_folhas e
-- decimo_terceiro_linhas, com snapshot do colaborador no momento da criacao
-- da folha + campos calculados (avos, parcelas, descontos, totais) + campos
-- de override manual para edicao linha a linha.
--
-- Referencias:
--   - docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md
--   - docs/superpowers/plans/2026-10-21-decimo-terceiro-parte-1.md (Task 1)
--
-- Decisoes incorporadas:
--   - Enum nasce com apenas 'rascunho'. Partes 3+ adicionam
--     'fechada_parcial_1', 'fechada_parcial_2', 'concluida' com
--     ALTER TYPE em migrations proprias (regra do FLUXO-BANCO sobre
--     adicao de valor em enum isolada).
--   - Snapshot grava copia dos dados do colaborador. Edicao de
--     colaboradores_salarios ou de colaboradores NAO altera a folha sozinha;
--     so o botao "Recalcular folha" (Task 4) rebusca.
--   - Elegibilidade por tipo_contratacao e por intervalo de ano fica no
--     server action; a tabela em si aceita qualquer tipo_contratacao.
--   - Base de calculo INSS/IRRF = 13o bruto integral (salario/12 * avos),
--     nao a 2a parcela isolada. Fica implementado em lib/decimo-terceiro/
--     calc.ts (Task 2); o banco so armazena os valores finais.
--
-- Esta migration e NAO-DESTRUTIVA: so adiciona objetos novos.

-- ===========================================================================
-- 1. Enum decimo_terceiro_folha_status
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'decimo_terceiro_folha_status') then
    create type public.decimo_terceiro_folha_status as enum ('rascunho');
  end if;
end$$;

comment on type public.decimo_terceiro_folha_status is
  'Status da folha de 13o salario do ano. Nasce com apenas rascunho; partes futuras adicionam fechada_parcial_1, fechada_parcial_2 e concluida.';

-- ===========================================================================
-- 2. Tabela decimo_terceiro_folhas (uma por ano)
-- ===========================================================================

create table if not exists public.decimo_terceiro_folhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  ano smallint not null check (ano between 2020 and 2100),
  status public.decimo_terceiro_folha_status not null default 'rascunho',
  criada_em timestamptz not null default now(),
  criada_por uuid references auth.users(id) on delete set null,
  recalculada_em timestamptz,
  recalculada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_decimo_terceiro_folha_ano unique (tenant_id, ano)
);

comment on table public.decimo_terceiro_folhas is
  'Folha anual de 13o salario — uma por (tenant, ano). Guarda o cabecalho; as linhas por colaborador ficam em decimo_terceiro_linhas.';

comment on column public.decimo_terceiro_folhas.recalculada_em is
  'Timestamp da ultima rodada de recalculo (Task 4). NULL ate o primeiro recalculo.';

-- ===========================================================================
-- 3. Tabela decimo_terceiro_linhas (uma por colaborador por folha)
-- ===========================================================================

create table if not exists public.decimo_terceiro_linhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  folha_id uuid not null references public.decimo_terceiro_folhas(id) on delete cascade,
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,

  -- Snapshot (puxado do cadastro na criacao da folha)
  snapshot_nome text not null,
  snapshot_cpf text,
  snapshot_tipo_contratacao public.tipo_contratacao not null,
  snapshot_funcao text not null,
  snapshot_data_admissao date not null,
  snapshot_salario numeric(14,2) not null check (snapshot_salario >= 0),
  snapshot_empresa_id uuid references public.empresas(id) on delete set null,

  -- Campos calculados
  avos smallint not null check (avos between 0 and 12),
  total_adiantado numeric(14,2) not null default 0 check (total_adiantado >= 0),
  primeira_parcela numeric(14,2) not null,
  segunda_parcela numeric(14,2) not null,
  desconto_inss numeric(14,2) not null default 0 check (desconto_inss >= 0),
  desconto_irrf numeric(14,2) not null default 0 check (desconto_irrf >= 0),
  total_bruto numeric(14,2) not null,
  total_liquido numeric(14,2) not null,

  -- Override manual
  editado_manualmente boolean not null default false,
  salario_editado numeric(14,2) check (salario_editado is null or salario_editado >= 0),
  avos_editado smallint check (avos_editado is null or avos_editado between 0 and 12),
  obs text,

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,

  constraint uniq_decimo_terceiro_linha_colab unique (folha_id, colaborador_id)
);

comment on table public.decimo_terceiro_linhas is
  'Linha de uma folha de 13o — uma por colaborador. Carrega snapshot do cadastro + campos calculados + overrides manuais. Edicao do cadastro NAO altera a linha sozinha; so o botao Recalcular (Task 4) rebusca.';

comment on column public.decimo_terceiro_linhas.editado_manualmente is
  'TRUE quando a linha teve salario_editado ou avos_editado preenchido. Recalculo preserva estas linhas; demais sao rebuscadas do cadastro.';

comment on column public.decimo_terceiro_linhas.total_adiantado is
  'Soma dos adiantamentos pedidos durante o ano (Parte 2). Na Parte 1 fica sempre 0 — a soma vem automatica quando a tabela de adiantamentos existir.';

-- ===========================================================================
-- 4. Indices
-- ===========================================================================

create index if not exists idx_decimo_terceiro_folhas_tenant_ano
  on public.decimo_terceiro_folhas (tenant_id, ano);

create index if not exists idx_decimo_terceiro_linhas_folha
  on public.decimo_terceiro_linhas (folha_id);

create index if not exists idx_decimo_terceiro_linhas_colaborador
  on public.decimo_terceiro_linhas (colaborador_id);

create index if not exists idx_decimo_terceiro_linhas_tenant
  on public.decimo_terceiro_linhas (tenant_id);

-- ===========================================================================
-- 5. Triggers de updated_at (fn_set_updated_at ja existe no banco)
-- ===========================================================================

drop trigger if exists trg_decimo_terceiro_folhas_updated_at on public.decimo_terceiro_folhas;
create trigger trg_decimo_terceiro_folhas_updated_at
  before update on public.decimo_terceiro_folhas
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_decimo_terceiro_linhas_updated_at on public.decimo_terceiro_linhas;
create trigger trg_decimo_terceiro_linhas_updated_at
  before update on public.decimo_terceiro_linhas
  for each row execute function public.fn_set_updated_at();

-- ===========================================================================
-- 6. RLS + policies (padrao do modulo RH: admin ou rh escrevem/leem tudo)
-- ===========================================================================

alter table public.decimo_terceiro_folhas enable row level security;
alter table public.decimo_terceiro_linhas enable row level security;

drop policy if exists decimo_terceiro_folhas_rh_admin_all on public.decimo_terceiro_folhas;
create policy decimo_terceiro_folhas_rh_admin_all on public.decimo_terceiro_folhas
  for all to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists decimo_terceiro_linhas_rh_admin_all on public.decimo_terceiro_linhas;
create policy decimo_terceiro_linhas_rh_admin_all on public.decimo_terceiro_linhas
  for all to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- ===========================================================================
-- 7. GRANT para authenticated — nada para anon
-- ===========================================================================

grant select, insert, update, delete on public.decimo_terceiro_folhas to authenticated;
grant select, insert, update, delete on public.decimo_terceiro_linhas to authenticated;
