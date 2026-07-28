-- =====================================================================
-- Task 007 — Projetos (guarda-chuva de orçamentos)
--
-- Introduz a entidade `projetos` entre `clientes` e `orcamentos`.
-- Cliente, responsável e campanha sobem do orçamento pro projeto.
-- Orçamento ganha FK NOT NULL pra projeto.
-- Cliente ganha `codigo_curto` (2-6 letras uppercase, único por tenant),
-- usado como prefixo do código do projeto.
--
-- Regras invioláveis respeitadas:
--   - `tenant_id` obrigatório com RLS via is_tenant_member.
--   - Sem policy DELETE (arquivar = status='arquivado').
--   - GRANT explícito no fim.
--   - Policies usam (select auth.uid()) pra evitar re-avaliação por linha.
--
-- Backfill: cria 1 projeto "teste" agrupando todos os orçamentos existentes
-- do tenant. Se não houver orçamentos (banco novo), skip.
-- =====================================================================

-- 1) clientes.codigo_curto ----------------------------------------------
alter table public.clientes add column if not exists codigo_curto text;

-- Backfill: derivar de nome_fantasia (primeiras 6 letras alfabéticas UPPER)
update public.clientes
   set codigo_curto = upper(regexp_replace(substring(nome_fantasia, 1, 6), '[^A-Za-z]', '', 'g'))
 where codigo_curto is null;

-- Fallback pra registros que ficaram vazios ou com menos de 2 letras (violaria o CHECK)
update public.clientes set codigo_curto = 'CLI'
 where codigo_curto is null or length(codigo_curto) < 2;

alter table public.clientes
  alter column codigo_curto set not null;

alter table public.clientes
  drop constraint if exists chk_clientes_codigo_curto_formato;

alter table public.clientes
  add constraint chk_clientes_codigo_curto_formato check (codigo_curto ~ '^[A-Z]{2,6}$');

create unique index if not exists uniq_clientes_codigo_curto_por_tenant
  on public.clientes(tenant_id, codigo_curto);

-- 2) projeto_status enum ------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'projeto_status') then
    create type public.projeto_status as enum ('ativo', 'arquivado');
  end if;
end$$;

-- 3) Tabela projetos ----------------------------------------------------
create table if not exists public.projetos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  codigo                text not null,
  nome                  text not null,
  campanha              text,
  cliente_id            uuid not null references public.clientes(id) on delete restrict,
  responsavel_id        uuid not null references public.profiles(id) on delete restrict,
  status                public.projeto_status not null default 'ativo',
  data_inicio_prevista  date not null,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists uniq_projetos_codigo_por_tenant on public.projetos(tenant_id, codigo);
create index if not exists idx_projetos_tenant       on public.projetos(tenant_id);
create index if not exists idx_projetos_cliente      on public.projetos(cliente_id);
create index if not exists idx_projetos_responsavel  on public.projetos(responsavel_id);
create index if not exists idx_projetos_status       on public.projetos(status);
create index if not exists idx_projetos_created_at   on public.projetos(created_at desc);

drop trigger if exists trg_projetos_updated_at on public.projetos;
create trigger trg_projetos_updated_at
  before update on public.projetos
  for each row execute function public.set_updated_at();

alter table public.projetos enable row level security;

drop policy if exists projetos_select on public.projetos;
create policy projetos_select on public.projetos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists projetos_insert on public.projetos;
create policy projetos_insert on public.projetos
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists projetos_update on public.projetos;
create policy projetos_update on public.projetos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE (arquivar = status='arquivado')

grant select, insert, update on public.projetos to authenticated;

-- 4) orcamentos.projeto_id (nullable → backfill → NOT NULL) -------------
alter table public.orcamentos
  add column if not exists projeto_id uuid references public.projetos(id) on delete restrict;

-- 5) BACKFILL: cria projeto "teste" e vincula orçamentos existentes -----
do $$
declare
  v_projeto_id uuid;
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_responsavel_id uuid;
  v_codigo_cliente text;
  v_ano text;
begin
  -- Pega dados de um orçamento existente (o mais antigo do tenant)
  -- Se não houver nenhum, sai do bloco (banco novo — nada a fazer)
  select o.tenant_id, o.cliente_id, o.responsavel_id, c.codigo_curto, to_char(current_date, 'YY')
    into v_tenant_id, v_cliente_id, v_responsavel_id, v_codigo_cliente, v_ano
    from public.orcamentos o
    join public.clientes c on c.id = o.cliente_id
   where o.projeto_id is null
   order by o.created_at asc
   limit 1;

  if v_tenant_id is null then
    return;
  end if;

  insert into public.projetos (
    tenant_id, codigo, nome, campanha, cliente_id, responsavel_id, status, data_inicio_prevista
  ) values (
    v_tenant_id,
    v_codigo_cliente || '-0001/' || v_ano,
    'teste',
    'teste',
    v_cliente_id,
    v_responsavel_id,
    'ativo',
    current_date
  )
  returning id into v_projeto_id;

  update public.orcamentos
     set projeto_id = v_projeto_id
   where tenant_id = v_tenant_id
     and projeto_id is null;
end$$;

-- 6) SET NOT NULL + índice + DROPs de colunas velhas --------------------
alter table public.orcamentos
  alter column projeto_id set not null;

create index if not exists idx_orcamentos_projeto on public.orcamentos(projeto_id);

alter table public.orcamentos
  drop column if exists cliente_id,
  drop column if exists responsavel_id,
  drop column if exists campanha;
