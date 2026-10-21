-- Motivo: Parte 2 do modulo de 13o - registrar adiantamentos pagos durante
-- o ano. Cada adiantamento vira lancamento no financeiro (contas_avulsas)
-- com plano '13 Salario' e abate automaticamente da 1a parcela quando a
-- folha for criada ou recalculada.
--
-- Vinculo pelo ANO (nao pela folha): pode haver adiantamento antes da folha
-- existir. Quando a folha e criada, soma todos os adiantamentos do ano por
-- colaborador. Quando um adiantamento e lancado DEPOIS da folha, a propria
-- action atualiza o total_adiantado da linha e recalcula.
--
-- Nao-destrutiva. Padrao de modulo RH: tenant_id, RLS, GRANT authenticated,
-- indices nas FKs.

create table if not exists public.decimo_terceiro_adiantamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  ano smallint not null check (ano between 2020 and 2100),
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  data date not null,
  valor numeric(14,2) not null check (valor > 0),
  obs text,
  /** Conta avulsa criada no financeiro ao lancar o adiantamento. NULL se
      o lancamento falhou e precisa ser refeito. */
  conta_avulsa_id uuid references public.contas_avulsas(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

comment on table public.decimo_terceiro_adiantamentos is
  'Adiantamento de 13o pago ao colaborador durante o ano (Parte 2). Vinculado por (ano, colaborador). Abate da 1a parcela do 13o do mesmo ano.';

comment on column public.decimo_terceiro_adiantamentos.conta_avulsa_id is
  'Lancamento financeiro gerado automaticamente. NULL quando a criacao da avulsa falhou (pode ser refeita).';

create index if not exists idx_decimo_terceiro_adiantamentos_tenant_ano
  on public.decimo_terceiro_adiantamentos (tenant_id, ano);

create index if not exists idx_decimo_terceiro_adiantamentos_colab_ano
  on public.decimo_terceiro_adiantamentos (colaborador_id, ano);

-- RLS: mesmo padrao do RH (admin ou rh)
alter table public.decimo_terceiro_adiantamentos enable row level security;

drop policy if exists decimo_terceiro_adiantamentos_rh_admin_all
  on public.decimo_terceiro_adiantamentos;
create policy decimo_terceiro_adiantamentos_rh_admin_all
  on public.decimo_terceiro_adiantamentos
  for all to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

grant select, insert, update, delete on public.decimo_terceiro_adiantamentos
  to authenticated;
