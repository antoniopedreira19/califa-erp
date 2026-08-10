-- =====================================================================
-- BV por item — bonificação negociada com o fornecedor.
--
-- O BV é a parcela que o fornecedor devolve à California, como comissão,
-- quando o item é de custo tipo A (aquele em que o cliente paga o
-- fornecedor diretamente). Por isso só existe BV em item tipo A.
--
-- Tabela própria, e não colunas em `versoes_orcamento_itens`, por dois
-- motivos:
--
--   1. `jobs_itens_orcado` é CÓPIA do item (criada na abertura do job e
--      alterável por errata). Com colunas, orçamento e job passariam a
--      ter BVs distintos, que divergiriam a cada errata. Com FK para o
--      item da versão, as duas telas apontam para o MESMO registro e não
--      há nada a sincronizar.
--   2. O BV tem ciclo de vida próprio (situação, prazo de repasse) e vai
--      virar lançamento de faturamento / contas a receber, então precisa
--      de linha própria para receber esses vínculos depois.
--
-- IMPORTANTE: hoje o BV NÃO abate custo e NÃO entra em rentabilidade. O
-- abatimento só passa a valer quando o valor tiver sido faturado e
-- estiver no contas a receber aguardando recebimento — módulos que ainda
-- não existem. Nada em `lib/calculos` muda nesta migration.
-- =====================================================================

-- ---------- 1. Enum de situação ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'bv_situacao') then
    create type public.bv_situacao as enum (
      'a_negociar',
      'confirmado',
      'recebido',
      'cancelado'
    );
  end if;
end$$;

-- ---------- 2. Tabela ----------
create table if not exists public.itens_bv (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- Item da VERSÃO, não do job: é o que faz o BV ser um só registro nas
  -- telas de Orçamento e de Job (jobs_itens_orcado.item_versao_id aponta
  -- para a mesma linha).
  item_versao_id uuid not null
    references public.versoes_orcamento_itens(id) on delete cascade,
  -- Opcional no orçamento: o GP pode lançar o valor antes de fechar com
  -- quem. A tela de acompanhamento do job destaca os que ficaram sem.
  fornecedor_id uuid references public.fornecedores(id) on delete restrict,
  valor numeric(14, 2) not null default 0,
  prazo_repasse date,
  situacao public.bv_situacao not null default 'a_negociar',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_bv_valor_nao_negativo check (valor >= 0),
  -- Um BV por item: o quadrado da calha alterna entre "+BV" (não existe)
  -- e "BV" (existe), sem estado intermediário de vários.
  constraint uniq_bv_item unique (item_versao_id)
);

create index if not exists idx_itens_bv_tenant on public.itens_bv(tenant_id);
create index if not exists idx_itens_bv_fornecedor on public.itens_bv(fornecedor_id);
create index if not exists idx_itens_bv_situacao on public.itens_bv(tenant_id, situacao);

drop trigger if exists trg_itens_bv_updated_at on public.itens_bv;
create trigger trg_itens_bv_updated_at
  before update on public.itens_bv
  for each row execute function public.set_updated_at();

-- ---------- 3. Regra de negócio no banco ----------
-- Tipo A é o que define a existência do BV. A Server Action já valida,
-- mas a regra é financeira: não pode depender de uma única camada.
create or replace function public.bv_exige_item_tipo_a()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo public.tipo_custo;
  v_tenant uuid;
begin
  select tipo_custo, tenant_id into v_tipo, v_tenant
  from public.versoes_orcamento_itens
  where id = new.item_versao_id;

  if v_tipo is null then
    raise exception 'Item da versão não encontrado.';
  end if;

  if v_tipo <> 'A' then
    raise exception 'BV só pode ser lançado em item de custo tipo A.';
  end if;

  -- O tenant do BV é o do item: fecha a porta para um BV apontando para
  -- item de outro tenant.
  if new.tenant_id <> v_tenant then
    raise exception 'Tenant do BV difere do tenant do item.';
  end if;

  return new;
end$$;

-- SECURITY DEFINER só faz sentido chamada pelo trigger. Ninguém invoca
-- direto do cliente.
revoke all on function public.bv_exige_item_tipo_a() from public, anon, authenticated;

drop trigger if exists trg_itens_bv_tipo_a on public.itens_bv;
create trigger trg_itens_bv_tipo_a
  before insert or update of item_versao_id, tenant_id on public.itens_bv
  for each row execute function public.bv_exige_item_tipo_a();

-- ---------- 4. RLS ----------
alter table public.itens_bv enable row level security;

drop policy if exists itens_bv_select on public.itens_bv;
create policy itens_bv_select on public.itens_bv
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists itens_bv_insert on public.itens_bv;
create policy itens_bv_insert on public.itens_bv
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists itens_bv_update on public.itens_bv;
create policy itens_bv_update on public.itens_bv
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists itens_bv_delete on public.itens_bv;
create policy itens_bv_delete on public.itens_bv
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.itens_bv to authenticated;
