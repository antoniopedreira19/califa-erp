-- =====================================================================
-- Desembolsos — 4ª origem de "Contas a Pagar"
-- =====================================================================
--
-- Nova entidade com workflow tipo PP (em_avaliacao → aprovada → pago),
-- rateio regional como avulsa e parcelas próprias. Qualquer membro do
-- tenant cria; admin/financeiro aprova/rejeita. Ver
-- docs/superpowers/specs/2026-08-20-desembolsos-design.md, seção 4.1.
--
-- Aditiva: 4 tabelas novas, 1 enum novo, 1 função de sequencial, 1
-- trigger de congelamento de data (reusa função existente). Zero
-- alteração em código existente.
-- =====================================================================

create type desembolso_status as enum
  ('em_avaliacao', 'aprovada', 'pago', 'rejeitada', 'cancelada');

create table desembolsos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  codigo text not null,
  empresa_id uuid not null references empresas(id),
  descricao text not null,
  valor numeric(14, 2) not null check (valor > 0),
  forma_pagamento forma_pagamento null,
  cartao_credito_id uuid null references cartoes_credito(id),
  status desembolso_status not null default 'em_avaliacao',
  fornecedor_id uuid null references fornecedores(id),
  cliente_id uuid null references clientes(id),
  job_id uuid null references jobs(id),
  data_prevista_pagamento date null,
  motivo_rejeicao text null,
  motivo_cancelamento text null,
  criado_por uuid not null references profiles(id),
  aprovada_por uuid null references profiles(id),
  aprovada_em timestamptz null,
  rejeitada_por uuid null references profiles(id),
  rejeitada_em timestamptz null,
  cancelada_por uuid null references profiles(id),
  cancelada_em timestamptz null,
  pago_em timestamptz null,
  pago_por uuid null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_desembolso_codigo_por_tenant unique (tenant_id, codigo),
  constraint desembolso_descricao_nao_vazia check (length(trim(descricao)) > 0),
  constraint chk_desembolso_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  )
);

comment on column desembolsos.forma_pagamento is
  'Nullable para casos edge onde o desembolso é criado antes de definir forma. Server action exige NOT NULL na criação normal.';

create index idx_desembolsos_tenant_status on desembolsos (tenant_id, status);
create index idx_desembolsos_criado_por on desembolsos (tenant_id, criado_por);
create index idx_desembolsos_job on desembolsos (tenant_id, job_id) where job_id is not null;
create index idx_desembolsos_cartao
  on desembolsos (tenant_id, cartao_credito_id)
  where cartao_credito_id is not null;

create table desembolsos_parcelas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  numero smallint not null check (numero >= 1),
  data_vencimento date not null,
  data_pagamento date null,
  data_pagamento_primeira date null,
  valor numeric(14, 2) not null check (valor > 0),
  pago_em date null,
  pago_por uuid null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_desembolso_parcela_numero unique (desembolso_id, numero)
);

comment on column desembolsos_parcelas.data_vencimento is
  'Vencimento ORIGINAL da parcela — informado na criação. Congelado após emissão.';
comment on column desembolsos_parcelas.data_pagamento is
  'Data de pagamento vigente, repactuável pelo lápis da aba Títulos a Pagar. Nasce na aprovação.';
comment on column desembolsos_parcelas.data_pagamento_primeira is
  'A primeira data de pagamento definida. Congelada por trigger — repactuar não altera.';

create index idx_desembolsos_parcelas_desembolso on desembolsos_parcelas (desembolso_id);
create index idx_desembolsos_parcelas_a_pagar
  on desembolsos_parcelas (tenant_id, data_pagamento)
  where pago_em is null;

create table desembolsos_regionais (
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  regional_id uuid not null references regionais(id),
  percentual numeric(5, 2) not null check (percentual > 0 and percentual <= 100),
  primary key (desembolso_id, regional_id)
);

create table desembolsos_anexos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  desembolso_id uuid not null references desembolsos(id) on delete cascade,
  arquivo_path text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null check (arquivo_tamanho_bytes >= 0),
  criado_por uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_desembolsos_anexos_desembolso on desembolsos_anexos (desembolso_id);

-- RLS
alter table desembolsos enable row level security;
alter table desembolsos_parcelas enable row level security;
alter table desembolsos_regionais enable row level security;
alter table desembolsos_anexos enable row level security;

create policy desembolsos_select on desembolsos
  for select to authenticated using (is_tenant_member(tenant_id));
create policy desembolsos_insert on desembolsos
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy desembolsos_update on desembolsos
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy desembolsos_delete on desembolsos
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy desembolsos_parcelas_select on desembolsos_parcelas
  for select to authenticated using (is_tenant_member(tenant_id));
create policy desembolsos_parcelas_insert on desembolsos_parcelas
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy desembolsos_parcelas_update on desembolsos_parcelas
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy desembolsos_parcelas_delete on desembolsos_parcelas
  for delete to authenticated using (is_tenant_member(tenant_id));

create policy desembolsos_regionais_select on desembolsos_regionais
  for select to authenticated
  using (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));
create policy desembolsos_regionais_insert on desembolsos_regionais
  for insert to authenticated
  with check (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));
create policy desembolsos_regionais_update on desembolsos_regionais
  for update to authenticated
  using (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)))
  with check (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));
create policy desembolsos_regionais_delete on desembolsos_regionais
  for delete to authenticated
  using (exists (select 1 from desembolsos d where d.id = desembolso_id and is_tenant_member(d.tenant_id)));

create policy desembolsos_anexos_select on desembolsos_anexos
  for select to authenticated using (is_tenant_member(tenant_id));
create policy desembolsos_anexos_insert on desembolsos_anexos
  for insert to authenticated with check (is_tenant_member(tenant_id));
create policy desembolsos_anexos_update on desembolsos_anexos
  for update to authenticated
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy desembolsos_anexos_delete on desembolsos_anexos
  for delete to authenticated using (is_tenant_member(tenant_id));

grant select, insert, update, delete on desembolsos to authenticated;
grant select, insert, update, delete on desembolsos_parcelas to authenticated;
grant select, insert, update, delete on desembolsos_regionais to authenticated;
grant select, insert, update, delete on desembolsos_anexos to authenticated;

-- Triggers
create trigger trg_desembolsos_updated_at
  before update on desembolsos
  for each row execute function set_updated_at();

create trigger trg_desembolsos_parcelas_updated_at
  before update on desembolsos_parcelas
  for each row execute function set_updated_at();

-- Reusa a função `congela_data_pagamento_primeira()` que já existe (criada
-- na migration 20260817000004_titulos_a_pagar).
create trigger trg_congela_primeira_data
  before update on desembolsos_parcelas
  for each row execute function congela_data_pagamento_primeira();

-- Sequencial DES-NNNNN por tenant (mesmo padrão de gerar_codigo_pp).
create or replace function gerar_codigo_desembolso(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prox integer;
  v_codigo text;
begin
  perform pg_advisory_xact_lock(hashtext('desembolso_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^DES-(\d+)$') as integer)), 0) + 1
    into v_prox
    from desembolsos
    where tenant_id = p_tenant_id
      and codigo ~ '^DES-\d+$';

  v_codigo := 'DES-' || lpad(v_prox::text, 5, '0');
  return v_codigo;
end;
$$;

revoke execute on function gerar_codigo_desembolso(uuid) from public;
grant execute on function gerar_codigo_desembolso(uuid) to authenticated;
