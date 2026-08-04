-- =====================================================================
-- Erratas: alterações do orçado depois da abertura do job.
--
-- Modelagem central: o job passa a ter CÓPIA PRÓPRIA dos itens orçados.
-- A versão aprovada do orçamento é o documento que o cliente aprovou e
-- continua intocada (a tela dela é read-only por isso). A errata altera
-- a cópia do job; o comercial segue vendo o que foi aprovado.
--
-- A ligação com `jobs_itens_realizado` continua sendo `item_versao_id`
-- (o id do item na versão), então nada em realizado ou em pedidos_compra
-- precisa ser remapeado.
-- =====================================================================

-- ---------- 1. Cópia do orçado por job ----------
create table if not exists public.jobs_itens_orcado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Item de origem na versão aprovada. Chave de ligação com o realizado.
  item_versao_id uuid not null references public.versoes_orcamento_itens(id),
  -- Grupos não mudam por errata, então seguem referenciando a versão.
  grupo_id uuid not null references public.versoes_orcamento_grupos(id),
  ordem integer not null default 0,
  item text not null,
  tipo_custo tipo_custo not null default 'A',
  categoria_id uuid references public.categorias(id),
  valor_unitario_orcado numeric not null default 0,
  quantidade_orcada numeric not null default 1,
  dias_meses_orcado numeric not null default 1,
  total_orcado numeric generated always as (
    coalesce(valor_unitario_orcado, 0) * coalesce(quantidade_orcada, 1) * coalesce(dias_meses_orcado, 1)
  ) stored,
  valor_unitario_planejado numeric not null default 0,
  quantidade_planejada numeric not null default 0,
  dias_meses_planejado numeric not null default 0,
  total_planejado numeric generated always as (
    coalesce(valor_unitario_planejado, 0) * coalesce(quantidade_planejada, 0) * coalesce(dias_meses_planejado, 0)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_job_item_versao unique (job_id, item_versao_id)
);

create index if not exists idx_jio_job on public.jobs_itens_orcado(job_id);
create index if not exists idx_jio_tenant on public.jobs_itens_orcado(tenant_id);
create index if not exists idx_jio_grupo on public.jobs_itens_orcado(grupo_id);
create index if not exists idx_jio_item_versao on public.jobs_itens_orcado(item_versao_id);

-- ---------- 2. Errata (uma por sessão de edição) ----------
create table if not exists public.jobs_erratas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  job_id uuid not null references public.jobs(id) on delete cascade,
  titulo text not null,
  justificativa text,
  -- Fotografia dos totais antes/depois, pra não depender de recalcular o
  -- passado se as regras de honorários ou imposto mudarem um dia.
  custo_orcado_antes numeric not null,
  custo_orcado_depois numeric not null,
  faturamento_antes numeric not null,
  faturamento_depois numeric not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_erratas_job on public.jobs_erratas(job_id, created_at desc);
create index if not exists idx_erratas_tenant on public.jobs_erratas(tenant_id);

-- ---------- 3. Itens alterados em cada errata ----------
create table if not exists public.jobs_erratas_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  errata_id uuid not null references public.jobs_erratas(id) on delete cascade,
  job_item_orcado_id uuid references public.jobs_itens_orcado(id) on delete set null,
  -- Nome do item e do grupo congelados: o histórico tem que continuar
  -- legível mesmo se o item for renomeado depois.
  item_nome text not null,
  grupo_nome text not null,
  tipo_custo_de tipo_custo not null,
  tipo_custo_para tipo_custo not null,
  valor_unitario_de numeric not null,
  valor_unitario_para numeric not null,
  total_de numeric not null,
  total_para numeric not null,
  -- Quanto ESTE item mexeu no faturamento. Honorários e imposto são
  -- lineares nas somas, então o efeito por item é exato e a soma dos
  -- itens bate com o delta da errata.
  efeito_faturamento numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_erratas_itens_errata on public.jobs_erratas_itens(errata_id);
create index if not exists idx_erratas_itens_tenant on public.jobs_erratas_itens(tenant_id);

-- ---------- 4. Faturamento congelado na abertura ----------
alter table public.jobs
  add column if not exists faturamento_abertura numeric;

comment on column public.jobs.faturamento_abertura is
  'Faturamento calculado quando o job foi aberto. Base de comparação do card de Erratas; não muda depois.';

-- ---------- 5. RLS ----------
alter table public.jobs_itens_orcado enable row level security;
alter table public.jobs_erratas enable row level security;
alter table public.jobs_erratas_itens enable row level security;

do $$ begin
  create policy jobs_itens_orcado_select on public.jobs_itens_orcado
    for select using (is_tenant_member(tenant_id));
  create policy jobs_itens_orcado_insert on public.jobs_itens_orcado
    for insert with check (is_tenant_member(tenant_id));
  create policy jobs_itens_orcado_update on public.jobs_itens_orcado
    for update using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
  create policy jobs_itens_orcado_delete on public.jobs_itens_orcado
    for delete using (is_tenant_member(tenant_id));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy jobs_erratas_select on public.jobs_erratas
    for select using (is_tenant_member(tenant_id));
  create policy jobs_erratas_insert on public.jobs_erratas
    for insert with check (is_tenant_member(tenant_id));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy jobs_erratas_itens_select on public.jobs_erratas_itens
    for select using (is_tenant_member(tenant_id));
  create policy jobs_erratas_itens_insert on public.jobs_erratas_itens
    for insert with check (is_tenant_member(tenant_id));
exception when duplicate_object then null;
end $$;

-- Errata é registro histórico: não se edita nem se apaga. Sem policy de
-- UPDATE/DELETE, o RLS já barra.

-- ---------- 6. Grants ----------
grant select, insert, update, delete on public.jobs_itens_orcado to authenticated;
grant select, insert on public.jobs_erratas to authenticated;
grant select, insert on public.jobs_erratas_itens to authenticated;
