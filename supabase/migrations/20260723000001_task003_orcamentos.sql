-- =====================================================================
-- Task 003 — Orçamentos (casca do MVP)
--
-- Cria a entidade central da fase pré-job: oportunidade comercial
-- vinculada a um cliente. Versões e aprovação vêm na Task 004; criação
-- de job vem na Task 005.
--
-- Decisões:
--   - `codigo` é único por tenant. Server Action auto-gera como
--     "ORC-NNNN" se vazio (contagem+1 do tenant).
--   - `versao_aprovada_id`, `aprovado_em`, `aprovado_por` NÃO existem
--     nesta migration — Task 004 adiciona via ALTER, quando a tabela
--     versoes_orcamento nascer.
--   - Status `aprovado` e `job_criado` não podem ser setados pelo app
--     via cliente comum (Server Action bloqueia). Vêm por transição
--     controlada em Tasks 004 e 005.
--   - Sem policy de DELETE. Cancelamento = status='cancelado'.
--
-- LIÇÃO Tasks anteriores: RLS não substitui GRANT. GRANT authenticated
--   no final desta migration.
-- =====================================================================

-- 1. Enum de status
do $$
begin
  if not exists (select 1 from pg_type where typname = 'orcamento_status') then
    create type public.orcamento_status as enum (
      'rascunho',
      'em_revisao',
      'enviado_cliente',
      'aprovado',
      'job_criado',
      'recusado',
      'cancelado'
    );
  end if;
end$$;

-- 2. Tabela orcamentos
create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  codigo text not null,
  nome text not null,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  gp_responsavel_id uuid not null references public.profiles(id) on delete restrict,
  status public.orcamento_status not null default 'rascunho',
  tipo text,
  campanha text,
  data_inicio_prevista date,
  data_fim_prevista date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orcamentos_datas_ordem check (
    data_inicio_prevista is null
    or data_fim_prevista is null
    or data_fim_prevista >= data_inicio_prevista
  )
);

create unique index if not exists uniq_orcamentos_codigo_por_tenant
  on public.orcamentos(tenant_id, codigo);

create index if not exists idx_orcamentos_tenant on public.orcamentos(tenant_id);
create index if not exists idx_orcamentos_cliente on public.orcamentos(cliente_id);
create index if not exists idx_orcamentos_gp on public.orcamentos(gp_responsavel_id);
create index if not exists idx_orcamentos_status on public.orcamentos(status);
create index if not exists idx_orcamentos_created_at on public.orcamentos(created_at desc);

drop trigger if exists trg_orcamentos_updated_at on public.orcamentos;
create trigger trg_orcamentos_updated_at
before update on public.orcamentos
for each row execute function public.set_updated_at();

-- 3. RLS
alter table public.orcamentos enable row level security;

drop policy if exists orcamentos_select on public.orcamentos;
create policy orcamentos_select on public.orcamentos
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists orcamentos_insert on public.orcamentos;
create policy orcamentos_insert on public.orcamentos
for insert
to authenticated
with check (
  public.is_tenant_member(tenant_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists orcamentos_update on public.orcamentos;
create policy orcamentos_update on public.orcamentos
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

-- Sem policy de delete: cancelamento é status='cancelado'.

-- 4. GRANTs
grant select, insert, update on public.orcamentos to authenticated;
