-- =====================================================================
-- RH — pipeline de Contratação (task 007)
-- =====================================================================
--
-- Contratação vive isolada de colaboradores. Quando o candidato assina e
-- o RH efetiva, os dados migram pra colaboradores (INSERT normal) e a
-- contratação fica com virou_colaborador_id preenchido pra histórico.
--
-- Fluxo:
--   rascunho → proposta_enviada → aceite_recebido → dados_completos
--   → (PJ: contrato_gerado) → contrato_assinado → efetivada
--
-- Saídas negativas: recusada (antes de assinar), desistiu (depois de
-- aceitar), expirada (token venceu).
--
-- Endpoints públicos (aceitar/recusar/salvar dados) rodam via service
-- client — token opaco de 32+ chars valida o acesso. RLS não se aplica
-- ao fluxo público, só ao RH.
-- =====================================================================

-- Enum de status
create type public.contratacao_status as enum (
  'rascunho',
  'proposta_enviada',
  'aceite_recebido',
  'dados_completos',
  'contrato_gerado',
  'contrato_assinado',
  'efetivada',
  'recusada',
  'desistiu',
  'expirada'
);

comment on type public.contratacao_status is
  'Estados da jornada de contratação. Só efetivada vira colaborador; recusada/desistiu/expirada são saídas negativas.';

-- Tabela principal
create table public.contratacoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Carta proposta (candidato vê)
  nome                  text not null,
  email                 text not null,
  cargo                 text not null,
  salario_proposto      numeric(12,2) not null,
  data_admissao         date not null,

  -- Interno RH (candidato não vê)
  empresa_id            uuid not null references public.empresas(id) on delete restrict,
  regional_id           uuid references public.regionais(id) on delete restrict,
  tipo_contratacao      public.tipo_contratacao not null,
  nivel_id              uuid references public.niveis(id) on delete set null,
  area                  text,
  pj_natureza           public.pj_natureza,

  -- Dados coletados no aceite (candidato preenche)
  cpf                   text,
  cnpj                  text,
  razao_social          text,
  rg                    text,
  telefone              text,
  data_nascimento       date,
  cep                   text,
  logradouro            text,
  numero                text,
  complemento           text,
  bairro                text,
  cidade                text,
  uf                    text,
  banco_codigo          text,
  banco_nome            text,
  agencia               text,
  agencia_dv            text,
  conta                 text,
  conta_dv              text,
  tipo_conta            public.tipo_conta_bancaria,
  pix_tipo              public.pix_tipo_chave,
  pix_chave             text,

  -- Estado
  status                public.contratacao_status not null default 'rascunho',
  motivo_recusa         text,
  motivo_desistencia    text,

  -- Datas por evento
  proposta_enviada_em          timestamptz,
  aceite_em                    timestamptz,
  dados_completados_em         timestamptz,
  contrato_gerado_em           timestamptz,
  contrato_assinado_anexado_em timestamptz,
  efetivada_em                 timestamptz,

  -- Link público
  token                 text not null unique,
  token_expira_em       timestamptz not null,

  -- Anexos (paths no bucket contratacoes-anexos)
  contrato_gerado_path    text,
  contrato_assinado_path  text,

  -- Conversão final
  virou_colaborador_id  uuid references public.colaboradores(id) on delete set null,

  -- FK composta garante que a regional pertence à empresa
  constraint fk_contratacao_regional_pertence_empresa
    foreign key (regional_id, empresa_id)
    references public.regionais(id, empresa_id)
    on delete restrict
);

-- CHECKs de formato (mesmos padrões de colaboradores)
alter table public.contratacoes
  add constraint chk_contratacoes_salario_positivo
    check (salario_proposto > 0),
  add constraint chk_contratacoes_cpf_formato
    check (cpf is null or cpf ~ '^[0-9]{11}$'),
  add constraint chk_contratacoes_cnpj_formato
    check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  add constraint chk_contratacoes_telefone_formato
    check (telefone is null or telefone ~ '^[0-9]{10,11}$'),
  add constraint chk_contratacoes_cep_formato
    check (cep is null or cep ~ '^[0-9]{8}$'),
  add constraint chk_contratacoes_uf_formato
    check (uf is null or uf ~ '^[A-Z]{2}$'),
  add constraint chk_contratacoes_rg_limite
    check (rg is null or length(rg) between 1 and 20),
  add constraint chk_contratacoes_token_min
    check (length(token) >= 32),
  add constraint chk_contratacoes_motivo_recusa
    check (
      (status <> 'recusada' and motivo_recusa is null)
      or (status = 'recusada' and motivo_recusa is not null)
    ),
  add constraint chk_contratacoes_motivo_desistencia
    check (
      (status <> 'desistiu' and motivo_desistencia is null)
      or (status = 'desistiu' and motivo_desistencia is not null)
    ),
  add constraint chk_contratacoes_efetivada_tem_colaborador
    check (
      (status <> 'efetivada')
      or (status = 'efetivada' and virou_colaborador_id is not null)
    );

-- Índices
create index idx_contratacoes_tenant_status
  on public.contratacoes (tenant_id, status);

create index idx_contratacoes_token
  on public.contratacoes (token);

create index idx_contratacoes_created_at
  on public.contratacoes (tenant_id, created_at desc);

-- Trigger de updated_at
create trigger contratacoes_updated_at
  before update on public.contratacoes
  for each row
  execute function public.set_updated_at();

-- RLS
alter table public.contratacoes enable row level security;

create policy contratacoes_select
  on public.contratacoes for select
  to authenticated
  using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy contratacoes_insert
  on public.contratacoes for insert
  to authenticated
  with check (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy contratacoes_update
  on public.contratacoes for update
  to authenticated
  using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  )
  with check (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
  );

create policy contratacoes_delete
  on public.contratacoes for delete
  to authenticated
  using (
    is_tenant_admin(tenant_id)
  );

-- GRANTs pra authenticated (anon não toca)
grant select, insert, update, delete on public.contratacoes to authenticated;

comment on table public.contratacoes is
  'Pipeline de contratação (task 007). Isolada de colaboradores; converte via server action efetivar() quando assinado. Endpoints públicos usam service client + token, sem RLS.';
comment on column public.contratacoes.token is
  'Token opaco de 32+ chars para o link público /proposta/[token]. Gerado no created; renovável via renovarLink().';
comment on column public.contratacoes.token_expira_em is
  'Expiração do link público. Default: created_at + 14 dias.';
comment on column public.contratacoes.virou_colaborador_id is
  'Preenchido quando status vira efetivada. Aponta pro colaborador criado na conversão.';
