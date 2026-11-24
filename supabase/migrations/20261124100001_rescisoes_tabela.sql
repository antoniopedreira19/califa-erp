-- Rescisões: tabela de primeira classe pra verbas rescisórias. Antes
-- era 100% derivado da tela — abriu /rh/rescisoes, calculou on-the-fly,
-- clicou "Como gerar pagamento" e lançou avulsa manual. Agora:
--   1. Ao inativar colaborador, uma linha nasce em rascunho com o
--      snapshot do cálculo (salário vigente, avos de férias via RPC,
--      avos de 13º pela regra do dia 15, totais).
--   2. RH ajusta descontos manuais (benefícios, outros) na tela.
--   3. Envio ao financeiro cria conta avulsa (plano 05.013 Rescisão)
--      e fecha a rescisão em `enviada_financeiro`.
--   4. Quando a avulsa é baixada em contas_a_pagar, trigger propaga
--      status = `paga`.
--
-- Status workflow (3 estados úteis + cancelada pra retomada):
--   rascunho → enviada_financeiro → paga
--   rascunho → cancelada (reativação do colaborador antes de enviar)
--
-- Snapshot de valores é congelado no envio pra não variar se o salário
-- vigente mudar depois. Em rascunho, pode ser recalculado a qualquer
-- hora pelo botão "Recalcular".

create type rescisao_status as enum (
  'rascunho',
  'enviada_financeiro',
  'paga',
  'cancelada'
);

create table rescisoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  colaborador_id uuid not null references colaboradores(id) on delete restrict,

  data_rescisao date not null,
  status rescisao_status not null default 'rascunho',

  -- Snapshot do cálculo (pode ser null em rascunho se a fonte sumir).
  salario_vigente numeric(14,2),
  saldo_salario_dias smallint,
  saldo_salario_valor numeric(14,2),
  avos_ferias smallint,
  valor_ferias numeric(14,2),
  valor_um_terco_ferias numeric(14,2),
  avos_decimo smallint,
  valor_decimo_terceiro numeric(14,2),

  -- Ajuste manual do RH (dedução de benefícios, outros descontos).
  -- `ajuste_valor` entra como SUBTRAÇÃO no líquido (positivo = desconto).
  ajuste_valor numeric(14,2) not null default 0,
  ajuste_motivo text,

  -- Totais efetivos que viram a avulsa.
  total_bruto numeric(14,2),
  total_liquido numeric(14,2),

  -- Rastreio do envio e pagamento.
  conta_avulsa_id uuid references contas_avulsas(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  enviada_em timestamptz,
  enviada_por uuid references profiles(id) on delete set null,
  paga_em timestamptz,
  paga_por uuid references profiles(id) on delete set null,
  cancelada_em timestamptz,
  cancelada_por uuid references profiles(id) on delete set null
);

-- Uma rescisão ativa por colaborador: `cancelada` libera o slot pra RH
-- reabrir (reativar + inativar de novo). Índice parcial faz o mesmo que
-- um EXCLUDE sem exigir btree_gist.
create unique index uniq_rescisao_ativa_por_colaborador
  on rescisoes(colaborador_id)
  where status in ('rascunho','enviada_financeiro','paga');

create index idx_rescisoes_tenant_status on rescisoes(tenant_id, status);
create index idx_rescisoes_colaborador on rescisoes(colaborador_id);
create index idx_rescisoes_data on rescisoes(data_rescisao desc);
create index idx_rescisoes_conta_avulsa on rescisoes(conta_avulsa_id) where conta_avulsa_id is not null;

alter table rescisoes enable row level security;

-- Leitura: admin + rh + financeiro (financeiro precisa ver o que chegou
-- pra pagar). Colaborador comum não enxerga.
create policy rescisoes_select
  on rescisoes for select
  using (
    exists (
      select 1 from tenant_members tm
       where tm.user_id = (select auth.uid())
         and tm.tenant_id = rescisoes.tenant_id
         and tm.status = 'ativo'
         and tm.role in ('administrador','rh','financeiro')
    )
  );

-- Mutação: admin + rh. Financeiro só consulta.
create policy rescisoes_insert
  on rescisoes for insert
  with check (
    exists (
      select 1 from tenant_members tm
       where tm.user_id = (select auth.uid())
         and tm.tenant_id = rescisoes.tenant_id
         and tm.status = 'ativo'
         and tm.role in ('administrador','rh')
    )
  );

create policy rescisoes_update
  on rescisoes for update
  using (
    exists (
      select 1 from tenant_members tm
       where tm.user_id = (select auth.uid())
         and tm.tenant_id = rescisoes.tenant_id
         and tm.status = 'ativo'
         and tm.role in ('administrador','rh')
    )
  );

-- Delete bloqueado: o workflow correto é cancelar (status=cancelada).
-- Sem policy de delete, tudo cai pra deny — nem admin consegue.

grant select, insert, update on rescisoes to authenticated;

-- Trigger pra updated_at.
create or replace function fn_rescisao_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_rescisao_updated_at
  before update on rescisoes
  for each row execute function fn_rescisao_set_updated_at();

-- Quando a conta avulsa vinculada é baixada, propaga pra rescisão.
-- Fluxo normal: RH envia → avulsa criada em 'aprovada' → financeiro
-- baixa (status='baixada') → esta trigger marca a rescisão como 'paga'.
create or replace function fn_rescisao_propaga_pagamento()
returns trigger language plpgsql as $$
begin
  if new.status = 'baixada' and (old.status is distinct from 'baixada') then
    update rescisoes
       set status = 'paga',
           paga_em = coalesce(new.pago_em::timestamptz, now()),
           paga_por = new.pago_por
     where conta_avulsa_id = new.id
       and status = 'enviada_financeiro';
  end if;
  return new;
end;
$$;

create trigger trg_conta_avulsa_propaga_rescisao
  after update of status on contas_avulsas
  for each row execute function fn_rescisao_propaga_pagamento();
