-- Racional: introduz forma_pagamento (enum) usada nas 3 tabelas de
-- origem de "Contas a Pagar" (PP, avulsa, recorrência) e o cadastro
-- de cartoes_credito com dia_vencimento_fatura. Migration aditiva:
-- não toca colunas existentes; as adições nas 3 tabelas ficam para
-- 20260820000002. Ver docs/superpowers/specs/2026-08-20-forma-pagamento
-- -e-cartoes-credito-design.md, seções 3.1, 3.2, 3.3 e 4.1.

create type forma_pagamento as enum
  ('pix', 'transferencia', 'boleto', 'cartao_credito');

create type bandeira_cartao as enum
  ('visa', 'master', 'elo', 'amex', 'hipercard', 'outra');

create table cartoes_credito (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  banco text not null,
  bandeira bandeira_cartao not null,
  ultimos_4_digitos text not null check (ultimos_4_digitos ~ '^\d{4}$'),
  dono text not null,
  dia_vencimento_fatura smallint not null
    check (dia_vencimento_fatura between 1 and 31),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, nome)
);

comment on table cartoes_credito is
  'Cartões de crédito do tenant. Referenciados pelos títulos com forma_pagamento=cartao_credito. dia_vencimento_fatura define a data de pagamento auto-preenchida do título.';

create index idx_cartoes_credito_tenant_ativo
  on cartoes_credito (tenant_id, ativo);

alter table cartoes_credito enable row level security;

create policy cartoes_credito_select on cartoes_credito
  for select to authenticated
  using (is_tenant_member(tenant_id));

create policy cartoes_credito_insert on cartoes_credito
  for insert to authenticated
  with check (is_tenant_member(tenant_id));

create policy cartoes_credito_update on cartoes_credito
  for update to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

create policy cartoes_credito_delete on cartoes_credito
  for delete to authenticated
  using (is_tenant_member(tenant_id));

grant select, insert, update, delete on cartoes_credito to authenticated;

-- Trigger para manter updated_at
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

-- A função pode já existir; usar create or replace acima é seguro.
create trigger trg_cartoes_credito_updated_at
  before update on cartoes_credito
  for each row execute function set_updated_at();
