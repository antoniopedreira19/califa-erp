-- =====================================================================
-- Meses da versão do orçamento (modelo mensal — Fee e Always On)
--
-- Um orçamento Fee/Always On representa UM trimestre civil, com 1 a 3
-- meses. Cada mês tem os seus próprios grupos e itens — na planilha de
-- referência (aba SUL) cada mês é um bloco inteiro, com equipe e verbas
-- que mudam de um mês para o outro.
--
-- O MÊS ENTRA NO GRUPO, NÃO NO ITEM. `versoes_orcamento_grupos` já é a
-- tabela que organiza a planilha; o item herda o mês pelo `grupo_id`.
-- Pôr o mês também no item criaria duas fontes para a mesma informação
-- — e um item "de julho" dentro de um grupo "de agosto".
--
-- O mês é uma linha própria (e não só uma coluna no grupo) porque ele
-- existe mesmo vazio: o trimestre nasce com os meses do período antes de
-- qualquer grupo, e apagar o último grupo de um mês não apaga o mês.
--
-- Decisão 076. Aditivo, exceto o item 3 (troca de índice), autorizado
-- pelo Tiago em 14/09/2026: nenhum dado é apagado.
-- =====================================================================

-- 1) a tabela dos meses ------------------------------------------------
create table if not exists public.versoes_orcamento_meses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  versao_orcamento_id uuid not null
    references public.versoes_orcamento(id) on delete cascade,
  -- Sempre o dia 1 do mês de referência.
  mes date not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_versoes_orcamento_meses_dia_1 check (extract(day from mes) = 1),
  constraint uniq_versoes_orcamento_meses_mes unique (versao_orcamento_id, mes),
  -- Alvo da FK composta do grupo: garante que o mês do grupo é da MESMA
  -- versão do grupo, sem trigger.
  constraint uniq_versoes_orcamento_meses_versao_id unique (versao_orcamento_id, id)
);

create index if not exists idx_versoes_orcamento_meses_tenant
  on public.versoes_orcamento_meses(tenant_id);

drop trigger if exists trg_versoes_orcamento_meses_updated_at
  on public.versoes_orcamento_meses;
create trigger trg_versoes_orcamento_meses_updated_at
  before update on public.versoes_orcamento_meses
  for each row execute function public.set_updated_at();

-- Os meses de uma versão ficam no MESMO trimestre civil. É isso que
-- limita a versão a 3 meses — junto do unique por mês — e mantém a regra
-- "um orçamento por trimestre" no banco, e não só na tela.
create or replace function public.versoes_orcamento_meses_mesmo_trimestre()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from public.versoes_orcamento_meses m
     where m.versao_orcamento_id = new.versao_orcamento_id
       and m.id <> new.id
       and (extract(year from m.mes) <> extract(year from new.mes)
            or extract(quarter from m.mes) <> extract(quarter from new.mes))
  ) then
    raise exception
      'Os meses de uma versão precisam ficar no mesmo trimestre.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_versoes_orcamento_meses_mesmo_trimestre
  on public.versoes_orcamento_meses;
create trigger trg_versoes_orcamento_meses_mesmo_trimestre
  before insert or update of mes, versao_orcamento_id
  on public.versoes_orcamento_meses
  for each row execute function public.versoes_orcamento_meses_mesmo_trimestre();

alter table public.versoes_orcamento_meses enable row level security;

drop policy if exists versoes_orcamento_meses_select on public.versoes_orcamento_meses;
create policy versoes_orcamento_meses_select on public.versoes_orcamento_meses
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists versoes_orcamento_meses_insert on public.versoes_orcamento_meses;
create policy versoes_orcamento_meses_insert on public.versoes_orcamento_meses
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists versoes_orcamento_meses_update on public.versoes_orcamento_meses;
create policy versoes_orcamento_meses_update on public.versoes_orcamento_meses
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- DELETE: apagar um mês é ação de tela ("Editar meses"). A FK dos grupos
-- é RESTRICT, então o mês só sai depois dos grupos dele.
drop policy if exists versoes_orcamento_meses_delete on public.versoes_orcamento_meses;
create policy versoes_orcamento_meses_delete on public.versoes_orcamento_meses
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete
  on public.versoes_orcamento_meses to authenticated;

comment on table public.versoes_orcamento_meses is
  'Meses de uma versão de orçamento do modelo mensal (Fee e Always On): de 1 a 3, todos no mesmo trimestre civil. Os grupos apontam para o mês por mes_id; os itens herdam pelo grupo. Decisão 076.';
comment on column public.versoes_orcamento_meses.mes is
  'Primeiro dia do mês de referência.';

-- 2) o mês no grupo ----------------------------------------------------
alter table public.versoes_orcamento_grupos
  add column if not exists mes_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'versoes_orcamento_grupos_mes_da_mesma_versao_fkey'
  ) then
    -- FK composta: com mes_id nulo (modelos nacional e internacional) ela
    -- não é conferida (MATCH SIMPLE). RESTRICT porque apagar um mês com
    -- grupo tem que ser uma ação explícita, que leva os itens junto.
    alter table public.versoes_orcamento_grupos
      add constraint versoes_orcamento_grupos_mes_da_mesma_versao_fkey
      foreign key (versao_orcamento_id, mes_id)
      references public.versoes_orcamento_meses(versao_orcamento_id, id)
      on delete restrict;
  end if;
end$$;

create index if not exists idx_grupos_mes
  on public.versoes_orcamento_grupos(mes_id)
  where mes_id is not null;

comment on column public.versoes_orcamento_grupos.mes_id is
  'Mês do grupo no modelo mensal (versoes_orcamento_meses). Nulo nos modelos nacional e internacional. Decisão 076.';

-- 3) nome do grupo: único por versão SEM mês, único por mês COM mês ----
-- ⚠️ Troca de índice autorizada pelo Tiago em 14/09/2026. No modelo
-- mensal cada mês tem o seu "Equipe"; o índice antigo recusaria o
-- segundo. Para versão sem mês a garantia é a mesma de antes, e o índice
-- mantém o NOME antigo — se algum tratamento de erro casar pelo nome da
-- constraint, ele continua funcionando.
create unique index if not exists uniq_grupo_nome_por_versao_tmp
  on public.versoes_orcamento_grupos (tenant_id, versao_orcamento_id, lower(nome))
  where mes_id is null;

drop index if exists public.uniq_grupo_nome_por_versao;
alter index if exists public.uniq_grupo_nome_por_versao_tmp
  rename to uniq_grupo_nome_por_versao;

create unique index if not exists uniq_grupo_nome_por_mes
  on public.versoes_orcamento_grupos (tenant_id, mes_id, lower(nome))
  where mes_id is not null;
