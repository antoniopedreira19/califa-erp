-- =====================================================================
-- RH — Fase 4: tabela colaboradores (cadastro mestre)
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Coração do MVP do módulo RH. Guarda os dados fixos do colaborador —
-- aqueles que não mudam com alocação (Camada 1) nem com folha
-- (Camada 2): nome, tipo de contratação, CPF/CNPJ, função, nível,
-- e-mail, admissão e encerramento.
--
-- Alocações vigentes (empresa × regional × %) moram em
-- colaboradores_alocacoes (Fase 5). Salário histórico mora em
-- colaboradores_salarios (Fase 6). Snapshot da folha mora em
-- folhas_pagamento + folhas_pagamento_alocacoes (Fase 7, esqueleto).
--
-- Dependências:
--   • public.tenants                                   — Task 001
--   • public.profiles                                  — Task 001
--   • public.fornecedores                              — Task 002
--   • public.niveis                                    — Fase 2 (20260916000003)
--   • public.tipo_contratacao (enum)                   — Fase 2
--   • public.cadastro_status (enum)                    — Task 002 (existente)
--   • public.set_updated_at() (trigger function)       — Task 001
--   • public.is_tenant_admin(uuid), is_tenant_rh(uuid) — Task 001 / Fase 1b
--
-- Decisões (docs/modulos/rh/03-modelo-de-dados.md §Tabela colaboradores):
--   • cpf_cnpj é OPCIONAL no cadastro (permite "cadastro rápido").
--     Antes de gerar folha, será exigido (validação da fase da folha).
--   • Formato do documento é derivado de tipo_contratacao via CHECK:
--       - pj, mei, clt_recibo → CNPJ (14 dígitos)
--       - clt, estagio        → CPF  (11 dígitos)
--   • fornecedor_id é FK OPCIONAL — reuso de dados bancários/PIX na
--     baixa da folha. Auto-match e criação-num-click são
--     responsabilidade da UI (form action). Sem unique cruzada com
--     fornecedores.cpf_cnpj — o link é explícito, não implícito.
--   • Soft-delete via status='inativo' + data_encerramento. Sem DELETE
--     policy.
--   • RLS gate role-específico: admin OR rh, nunca is_tenant_member.
--
-- Aditivo do começo ao fim: nenhuma tabela existente é modificada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tabela colaboradores
-- ---------------------------------------------------------------------

create table if not exists public.colaboradores (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,

  nome               text not null,
  email              text,
  tipo_contratacao   public.tipo_contratacao not null,
  cpf_cnpj           text,
  funcao             text not null,
  nivel_id           uuid references public.niveis(id) on delete restrict,

  fornecedor_id      uuid references public.fornecedores(id) on delete restrict,

  data_admissao      date not null,
  data_encerramento  date,

  status             public.cadastro_status not null default 'ativo',

  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Formato de documento derivado de tipo_contratacao
  constraint chk_colaboradores_cpf_cnpj_formato check (
    cpf_cnpj is null
    or (tipo_contratacao in ('clt','estagio')          and cpf_cnpj ~ '^[0-9]{11}$')
    or (tipo_contratacao in ('pj','mei','clt_recibo')  and cpf_cnpj ~ '^[0-9]{14}$')
  ),

  -- Encerramento coerente com status
  constraint chk_colaboradores_encerramento_coerente check (
    (status = 'ativo'   and data_encerramento is null)
    or status = 'inativo'
  ),

  -- Nome com pelo menos 2 caracteres úteis
  constraint chk_colaboradores_nome_nao_vazio check (length(trim(nome)) >= 2),

  -- Função não vazia
  constraint chk_colaboradores_funcao_nao_vazia check (length(trim(funcao)) >= 1)
);

comment on table public.colaboradores is
  'Cadastro mestre de colaboradores da agencia. Dados que nao mudam com alocacao (Camada 1) nem com folha (Camada 2). RLS gate: administrador OR rh.';

comment on column public.colaboradores.cpf_cnpj is
  'Documento em digitos puros. CNPJ (14) para pj/mei/clt_recibo, CPF (11) para clt/estagio. Opcional no cadastro rapido — exigido antes de gerar folha.';

comment on column public.colaboradores.fornecedor_id is
  'Link OPCIONAL para fornecedor existente com mesmo CPF/CNPJ. Reusa dados bancarios/PIX na baixa da folha. Nulo quando colaborador nao emite NF (CLT/estagio) ou quando fornecedor ainda nao foi cadastrado.';

comment on column public.colaboradores.data_encerramento is
  'Data efetiva do encerramento do vinculo. So faz sentido quando status=inativo (constraint chk_colaboradores_encerramento_coerente).';

comment on column public.colaboradores.status is
  'ativo: em atividade. inativo: soft-delete — colaborador saiu, historico preservado. Nunca DELETE fisico.';


-- ---------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------

-- Duplicidade evidente por documento dentro do tenant.
create unique index if not exists uniq_colaboradores_documento_por_tenant
  on public.colaboradores (tenant_id, cpf_cnpj)
  where cpf_cnpj is not null;

create index if not exists idx_colaboradores_tenant
  on public.colaboradores (tenant_id);

create index if not exists idx_colaboradores_status
  on public.colaboradores (tenant_id, status);

create index if not exists idx_colaboradores_nivel
  on public.colaboradores (nivel_id);

create index if not exists idx_colaboradores_fornecedor
  on public.colaboradores (fornecedor_id);

create index if not exists idx_colaboradores_ativos
  on public.colaboradores (tenant_id) where status = 'ativo';


-- ---------------------------------------------------------------------
-- 3. Trigger updated_at
-- ---------------------------------------------------------------------

drop trigger if exists trg_colaboradores_updated_at on public.colaboradores;
create trigger trg_colaboradores_updated_at
  before update on public.colaboradores
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 4. RLS + policies (admin OR rh)
-- ---------------------------------------------------------------------

alter table public.colaboradores enable row level security;

drop policy if exists colaboradores_select on public.colaboradores;
create policy colaboradores_select on public.colaboradores
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists colaboradores_insert on public.colaboradores;
create policy colaboradores_insert on public.colaboradores
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists colaboradores_update on public.colaboradores;
create policy colaboradores_update on public.colaboradores
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- Sem policy DELETE — soft-delete via status=inativo + data_encerramento.


-- ---------------------------------------------------------------------
-- 5. GRANT
-- ---------------------------------------------------------------------

grant select, insert, update on public.colaboradores to authenticated;
