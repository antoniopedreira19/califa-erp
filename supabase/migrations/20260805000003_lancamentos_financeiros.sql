-- =====================================================================
-- Task 011 — lancamentos_financeiros (hub central)
-- Ver spec: docs/superpowers/specs/2026-08-05-lancamentos-financeiros-design.md
-- =====================================================================

-- 1) Enums
do $$ begin
  create type natureza_lancamento as enum ('entrada', 'saida');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type origem_lancamento as enum
    ('pp_baixa', 'pp_baixa_estornada', 'pp_estorno', 'manual');
exception when duplicate_object then null;
end $$;

-- 2) Tabela
create table if not exists public.lancamentos_financeiros (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  empresa_id                uuid not null references public.empresas(id) on delete restrict,
  conta_bancaria_id         uuid not null,
  data_movimento            date not null,
  valor                     numeric(14,2) not null,
  natureza                  natureza_lancamento not null,
  descricao                 text not null,
  plano_conta_tipo_id       uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id    uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  fornecedor_id             uuid references public.fornecedores(id) on delete restrict,
  cliente_id                uuid references public.clientes(id) on delete restrict,
  job_id                    uuid references public.jobs(id) on delete restrict,
  pedido_compra_id          uuid references public.pedidos_compra(id) on delete restrict,
  estorno_de_lancamento_id  uuid references public.lancamentos_financeiros(id) on delete restrict,
  origem                    origem_lancamento not null default 'manual',
  criado_por                uuid not null references public.profiles(id),
  created_at                timestamptz not null default now(),
  constraint chk_valor_positivo check (valor > 0),
  constraint chk_descricao_nao_vazia check (length(trim(descricao)) >= 3),
  constraint fk_lancamento_conta_empresa
    foreign key (conta_bancaria_id, empresa_id)
    references public.contas_bancarias (id, empresa_id) on delete restrict,
  constraint chk_estorno_consistente check (
    (origem = 'pp_estorno' and estorno_de_lancamento_id is not null)
    or
    (origem <> 'pp_estorno' and estorno_de_lancamento_id is null)
  ),
  constraint chk_origem_pp_tem_pp_id check (
    (origem in ('pp_baixa','pp_baixa_estornada','pp_estorno') and pedido_compra_id is not null)
    or
    (origem = 'manual' and pedido_compra_id is null)
  )
);

-- 3) Unique parcial
create unique index if not exists uniq_baixa_ativa_por_pp
  on public.lancamentos_financeiros(pedido_compra_id)
  where origem = 'pp_baixa';

-- 4) Índices operacionais
create index if not exists idx_lanc_tenant on public.lancamentos_financeiros(tenant_id);
create index if not exists idx_lanc_conta_data
  on public.lancamentos_financeiros(tenant_id, conta_bancaria_id, data_movimento);
create index if not exists idx_lanc_data
  on public.lancamentos_financeiros(tenant_id, data_movimento);
create index if not exists idx_lanc_fornecedor on public.lancamentos_financeiros(fornecedor_id);
create index if not exists idx_lanc_job on public.lancamentos_financeiros(job_id);
create index if not exists idx_lanc_pp on public.lancamentos_financeiros(pedido_compra_id);
create index if not exists idx_lanc_tipo on public.lancamentos_financeiros(plano_conta_tipo_id);

-- 5) RLS + GRANT
alter table public.lancamentos_financeiros enable row level security;

drop policy if exists lancamentos_select on public.lancamentos_financeiros;
create policy lancamentos_select on public.lancamentos_financeiros
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists lancamentos_insert on public.lancamentos_financeiros;
create policy lancamentos_insert on public.lancamentos_financeiros
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists lancamentos_update on public.lancamentos_financeiros;
create policy lancamentos_update on public.lancamentos_financeiros
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.lancamentos_financeiros to authenticated;

-- 6) Trigger de imutabilidade do codigo do tipo
create or replace function public.enforce_tipo_codigo_imutavel()
returns trigger language plpgsql as $$
begin
  if NEW.codigo is distinct from OLD.codigo
     and exists (select 1 from public.lancamentos_financeiros
                  where plano_conta_tipo_id = OLD.id) then
    raise exception
      'Código do tipo % não pode ser alterado após o primeiro lançamento.', OLD.codigo
      using errcode = 'P0001';
  end if;
  return NEW;
end$$;

drop trigger if exists trg_tipo_codigo_imutavel on public.plano_contas_tipos;
create trigger trg_tipo_codigo_imutavel
  before update on public.plano_contas_tipos
  for each row execute function public.enforce_tipo_codigo_imutavel();
