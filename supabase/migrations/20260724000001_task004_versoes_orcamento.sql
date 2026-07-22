-- =====================================================================
-- Task 004 fase B — Versões de orçamento e itens (criação manual)
--
-- Escopo desta migration:
--   - versoes_orcamento (v1, v2, v3...) com header/metadata
--   - versoes_orcamento_itens (linhas de custo com tipos A/B/C/D)
--   - ALTER em orcamentos: versao_aprovada_id + aprovado_em/por
--
-- FORA de escopo aqui:
--   - orcamento_importacoes (importação de planilha vem em fase futura)
--   - arquivo_original_url em versoes_orcamento (idem)
--   - trigger de bloqueio de edição em versão aprovada (Fase E)
--   - auto-atualização de orcamentos quando versão vira aprovada (Fase E)
--
-- Regras críticas garantidas no banco:
--   1. numero_versao único por orçamento (unique index composto)
--   2. só UMA versão aprovada por orçamento (unique index parcial)
--   3. total_orcado é GENERATED (nunca sai de sincronia com valor/qtd/dias)
--
-- LIÇÃO Tasks anteriores: GRANTs para authenticated no final. RLS não
-- substitui GRANT.
-- =====================================================================

-- 1. Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'versao_orcamento_status') then
    create type public.versao_orcamento_status as enum (
      'rascunho',
      'em_revisao',
      'enviada_cliente',
      'aprovada',
      'reprovada',
      'substituida',
      'cancelada'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_custo') then
    -- A: faturamento direto p/ cliente; imposto sobre honorários (13% padrão)
    -- B: bi-tributação; faturado via California; imposto sobre custo+honorários
    -- C: sem cobrança de honorários; permissão do Bruno; auditado
    -- D: faturamento direto p/ cliente, uso interno do GP
    create type public.tipo_custo as enum ('A', 'B', 'C', 'D');
  end if;
end$$;

-- 2. versoes_orcamento
create table if not exists public.versoes_orcamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  numero_versao integer not null,
  nome text,
  status public.versao_orcamento_status not null default 'rascunho',
  moeda text not null default 'BRL',
  taxa_cambio numeric(12, 4) not null default 1,
  percentual_honorarios numeric(6, 3) not null default 0,
  percentual_imposto numeric(6, 3) not null default 0,
  aprovado_em timestamptz,
  aprovado_por uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint versoes_orcamento_numero_positivo check (numero_versao > 0),
  constraint versoes_orcamento_taxa_positiva check (taxa_cambio > 0),
  constraint versoes_orcamento_percentuais_validos check (
    percentual_honorarios >= 0
    and percentual_honorarios <= 100
    and percentual_imposto >= 0
    and percentual_imposto <= 100
  )
);

create unique index if not exists uniq_versao_numero_por_orcamento
  on public.versoes_orcamento(tenant_id, orcamento_id, numero_versao);

-- Apenas UMA versão aprovada por orçamento (regra de negócio central).
create unique index if not exists uniq_versao_aprovada_por_orcamento
  on public.versoes_orcamento(tenant_id, orcamento_id)
  where status = 'aprovada';

create index if not exists idx_versoes_tenant on public.versoes_orcamento(tenant_id);
create index if not exists idx_versoes_orcamento on public.versoes_orcamento(orcamento_id);
create index if not exists idx_versoes_status on public.versoes_orcamento(status);
create index if not exists idx_versoes_created_at on public.versoes_orcamento(created_at desc);

drop trigger if exists trg_versoes_orcamento_updated_at on public.versoes_orcamento;
create trigger trg_versoes_orcamento_updated_at
before update on public.versoes_orcamento
for each row execute function public.set_updated_at();

-- 3. versoes_orcamento_itens
create table if not exists public.versoes_orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  versao_orcamento_id uuid not null references public.versoes_orcamento(id) on delete cascade,
  ordem integer not null default 0,
  grupo text,
  planilha_origem text, -- referência para futura importação; hoje null
  item text not null,
  tipo_custo public.tipo_custo not null default 'A',
  valor_unitario_orcado numeric(14, 2) not null default 0,
  quantidade_orcada numeric(12, 3) not null default 1,
  dias_meses_orcado numeric(12, 3) not null default 1,
  -- GENERATED garante consistência: nunca há total salvo divergente
  -- de valor × qtd × dias/meses.
  total_orcado numeric(18, 2) generated always as (
    coalesce(valor_unitario_orcado, 0)
    * coalesce(quantidade_orcada, 1)
    * coalesce(dias_meses_orcado, 1)
  ) stored,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itens_valor_nao_negativo check (valor_unitario_orcado >= 0),
  constraint itens_quantidade_positiva check (quantidade_orcada > 0),
  constraint itens_dias_meses_positivo check (dias_meses_orcado > 0)
);

create index if not exists idx_itens_tenant on public.versoes_orcamento_itens(tenant_id);
create index if not exists idx_itens_versao on public.versoes_orcamento_itens(versao_orcamento_id);
create index if not exists idx_itens_fornecedor on public.versoes_orcamento_itens(fornecedor_id);
create index if not exists idx_itens_tipo_custo on public.versoes_orcamento_itens(versao_orcamento_id, tipo_custo);

drop trigger if exists trg_itens_updated_at on public.versoes_orcamento_itens;
create trigger trg_itens_updated_at
before update on public.versoes_orcamento_itens
for each row execute function public.set_updated_at();

-- 4. ALTER orcamentos: campos de aprovação
alter table public.orcamentos
  add column if not exists versao_aprovada_id uuid
    references public.versoes_orcamento(id) on delete set null;

alter table public.orcamentos
  add column if not exists aprovado_em timestamptz;

alter table public.orcamentos
  add column if not exists aprovado_por uuid
    references auth.users(id) on delete set null;

create index if not exists idx_orcamentos_versao_aprovada
  on public.orcamentos(versao_aprovada_id)
  where versao_aprovada_id is not null;

-- 5. RLS versoes_orcamento
alter table public.versoes_orcamento enable row level security;

drop policy if exists versoes_select on public.versoes_orcamento;
create policy versoes_select on public.versoes_orcamento
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists versoes_insert on public.versoes_orcamento;
create policy versoes_insert on public.versoes_orcamento
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists versoes_update on public.versoes_orcamento;
create policy versoes_update on public.versoes_orcamento
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

-- Sem policy de delete: cancelamento = status='cancelada'.

-- 6. RLS versoes_orcamento_itens
alter table public.versoes_orcamento_itens enable row level security;

drop policy if exists itens_select on public.versoes_orcamento_itens;
create policy itens_select on public.versoes_orcamento_itens
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists itens_insert on public.versoes_orcamento_itens;
create policy itens_insert on public.versoes_orcamento_itens
for insert
to authenticated
with check (public.is_tenant_member(tenant_id));

drop policy if exists itens_update on public.versoes_orcamento_itens;
create policy itens_update on public.versoes_orcamento_itens
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

-- Itens PODEM ser deletados (usuário remove linha do orçamento em rascunho).
-- Diferente de versão, que é histórica.
drop policy if exists itens_delete on public.versoes_orcamento_itens;
create policy itens_delete on public.versoes_orcamento_itens
for delete
to authenticated
using (public.is_tenant_member(tenant_id));

-- 7. GRANTs
grant select, insert, update on public.versoes_orcamento to authenticated;
grant select, insert, update, delete on public.versoes_orcamento_itens to authenticated;
