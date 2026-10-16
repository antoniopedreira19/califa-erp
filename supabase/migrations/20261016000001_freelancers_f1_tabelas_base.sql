-- Task 011 — Freelancers (Fase 1, Task 1): tabelas base
--
-- Cria o cadastro mestre de freelancer e o catálogo de cargos do módulo.
-- Nenhuma tabela de contrato, solicitação ou histórico nasce aqui — vêm
-- nas tasks subsequentes.
--
-- Decisões não óbvias (travadas em alinhamento 16/10/2026):
--   * CPF é opcional (freela estrangeiro ou pessoa sem CPF podem existir).
--     Unique só vale quando IS NOT NULL — índice parcial por tenant.
--   * CNPJ + razão social são par: ou os dois null ou os dois preenchidos.
--     Garantido por check constraint. Dedup de CNPJ é por tenant.
--   * Não existe campo `ativo` nem `status_real` em freelancers. Status
--     do freela é derivado dos contratos (Fase 2). Freela sem contrato
--     ativo = "sem vínculo" — regra implementada na view do perfil.
--   * `endereco` em campos estruturados (CEP, rua, número, complemento,
--     bairro, cidade). O AgCaliforniaRH tinha texto livre legado; aqui
--     começamos limpo. Migração legada (Fase 5) faz parse do texto livre.
--   * `cidade` em freelancers é texto livre (residência do freela, pode
--     ser qualquer cidade). A tabela `cidades` do califa-erp é usada em
--     `jobs`/`projetos` com propósito diferente.
--   * O catálogo `freelancer_cargos` é isolado — não reaproveita o
--     catálogo `cargos` nem é relacionado ao catálogo de jobs do califa.
--     Nome é unique por tenant.
--
-- RLS:
--   freelancers: todos os membros do tenant leem; só admin/rh/financeiro
--   escrevem; só admin/rh deletam.
--   freelancer_cargos: todos leem; só admin/rh gerenciam.
--
-- A tabela `freelas` existente (70 linhas, decisão 164) NÃO é tocada.
-- Ela segue servindo verba de alimentação/transporte das PPs. Numa task
-- futura (pós-Fase 5), decidimos se vira FK pra `freelancers` ou some.

-- ---------- TABELA: freelancers ----------
create table if not exists public.freelancers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Identificação
  nome_social text not null,
  nome_completo text,
  cpf text,
  rg text,
  data_nascimento date,

  -- Contato
  email text,
  celular text,

  -- Endereço estruturado
  cep text,
  rua text,
  numero text,
  complemento text,
  bairro text,
  cidade text,

  -- Pessoa jurídica (opcional)
  cnpj text,
  razao_social text,
  cartao_cnpj_url text,

  -- Pagamento
  tipo_pagamento text,
  banco text,
  agencia text,
  conta text,
  pix_chave text,

  -- Diversidade / saúde (opcional)
  cor_raca text,
  identidade_genero text,
  deficiencia text,
  saude_obs text,
  contato_emergencia text,

  -- Workflow
  acao_prevista text,
  origem text not null default 'manual',

  -- Auditoria
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,

  -- Checks
  constraint freelancers_tipo_pagamento_check
    check (tipo_pagamento is null or tipo_pagamento in ('conta_bancaria', 'pix')),
  constraint freelancers_acao_prevista_check
    check (acao_prevista is null or acao_prevista in
      ('contratar', 'renovar', 'manter', 'substituir', 'encerrar')),
  constraint freelancers_origem_check
    check (origem in ('manual', 'form_publico', 'migracao')),
  -- CNPJ e razão social andam juntos: ou os dois nulos, ou os dois preenchidos
  constraint freelancers_cnpj_razao_social_par
    check (
      (cnpj is null and razao_social is null)
      or (cnpj is not null and razao_social is not null)
    )
);

comment on table public.freelancers is
  'Cadastro mestre de freelancers do tenant. Dados pessoais, endereço, PJ opcional e preferências. Status é derivado dos contratos (ver Fase 2).';

-- ---------- Índices em freelancers ----------
create index if not exists idx_freelancers_tenant
  on public.freelancers (tenant_id);

-- Unique parcial: dedup por CPF só quando preenchido
create unique index if not exists uq_freelancers_tenant_cpf
  on public.freelancers (tenant_id, cpf)
  where cpf is not null;

-- Unique parcial: dedup por CNPJ só quando preenchido
create unique index if not exists uq_freelancers_tenant_cnpj
  on public.freelancers (tenant_id, cnpj)
  where cnpj is not null;

-- Busca por nome case-insensitive
create index if not exists idx_freelancers_tenant_nome_social_lower
  on public.freelancers (tenant_id, lower(nome_social));

-- Covering indexes das FKs opcionais (advisor flagou)
create index if not exists idx_freelancers_created_by
  on public.freelancers (created_by)
  where created_by is not null;

create index if not exists idx_freelancers_updated_by
  on public.freelancers (updated_by)
  where updated_by is not null;

-- ---------- RLS em freelancers ----------
alter table public.freelancers enable row level security;

-- SELECT: todos os membros ativos do tenant veem o cadastro.
-- Visibilidade mais fina (GP só vê os freelas com contrato dele) virá na
-- Fase 2 via join com freelancer_contratos.
create policy freelancers_select on public.freelancers
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- INSERT: admin, RH e Financeiro cadastram. GP pede via solicitação (Fase 3).
create policy freelancers_insert on public.freelancers
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

create policy freelancers_update on public.freelancers
  for update to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  )
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

-- DELETE: só admin e RH. Financeiro não deleta cadastro.
create policy freelancers_delete on public.freelancers
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

-- Trigger de updated_at (função set_updated_at já existe no banco)
drop trigger if exists trg_freelancers_updated_at on public.freelancers;
create trigger trg_freelancers_updated_at
  before update on public.freelancers
  for each row execute function public.set_updated_at();

-- Grants
grant select, insert, update, delete on public.freelancers to authenticated;
revoke all on public.freelancers from anon;

-- ---------- TABELA: freelancer_cargos ----------
create table if not exists public.freelancer_cargos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint freelancer_cargos_nome_tenant_unico unique (tenant_id, nome)
);

comment on table public.freelancer_cargos is
  'Catálogo de cargos usados no autocomplete dos contratos de freelancer. Isolado dos outros catálogos; nome unique por tenant.';

create index if not exists idx_freelancer_cargos_tenant
  on public.freelancer_cargos (tenant_id);

create index if not exists idx_freelancer_cargos_tenant_nome_lower
  on public.freelancer_cargos (tenant_id, lower(nome));

create index if not exists idx_freelancer_cargos_tenant_ativo
  on public.freelancer_cargos (tenant_id, ativo);

create index if not exists idx_freelancer_cargos_created_by
  on public.freelancer_cargos (created_by)
  where created_by is not null;

-- ---------- RLS em freelancer_cargos ----------
alter table public.freelancer_cargos enable row level security;

create policy freelancer_cargos_select on public.freelancer_cargos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy freelancer_cargos_insert on public.freelancer_cargos
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

create policy freelancer_cargos_update on public.freelancer_cargos
  for update to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  )
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

create policy freelancer_cargos_delete on public.freelancer_cargos
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

grant select, insert, update, delete on public.freelancer_cargos to authenticated;
revoke all on public.freelancer_cargos from anon;

-- ---------- Seed de cargos iniciais ----------
-- Importado do AgCaliforniaRH (schema.sql linhas 181-247). Idempotente:
-- rodar duas vezes não duplica (unique por tenant_id + nome).
insert into public.freelancer_cargos (tenant_id, nome)
select t.id, c.nome
from public.tenants t
cross join (values
  ('Gerente de Projetos'),
  ('Planejamento Estratégico'),
  ('Produtor(a)'),
  ('Diretor de Arte'),
  ('Filmmaker'),
  ('Social Media'),
  ('Head de Projetos'),
  ('Head de Digital'),
  ('Head de Conteúdo'),
  ('Gerente de Produção'),
  ('Diretor de Projetos'),
  ('Digital'),
  ('Comercial/Growth'),
  ('CEO'),
  ('RH'),
  ('Recepcionista'),
  ('PR'),
  ('Mídia'),
  ('Jurídico'),
  ('Gerente Financeira'),
  ('Financeiro'),
  ('Estagiária de Social Media'),
  ('Diretor do CSC'),
  ('Diretor de Growth'),
  ('Diretor de Digital'),
  ('Diretor de Criação'),
  ('Controller'),
  ('Computação Gráfica - CG'),
  ('Administrador'),
  ('Redator / Planejamento'),
  ('Produtora de Conteúdo'),
  ('Produtora'),
  ('Produtor'),
  ('Planejamento'),
  ('Head Gerente de Projeto'),
  ('Head de Produção e Planejamento Operacional'),
  ('Gerente de Projetos Júnior'),
  ('Gerente de Projetos - Krafton'),
  ('Executiva de Mídia'),
  ('Estagiário Financeiro'),
  ('Estagiária Social Media / Krafton'),
  ('Estagiária do Financeiro'),
  ('Estagiária de Produção de Eventos'),
  ('Editor / Motion'),
  ('Diretor de Conteúdo'),
  ('Diretor de Arte 3D'),
  ('DA'),
  ('Coordenadora de Social Media'),
  ('Coordenadora de Planejamento'),
  ('Community Manager LATAM'),
  ('Community Manager'),
  ('Comercial'),
  ('Cinegrafista'),
  ('BI'),
  ('Auxiliar de Serviços Gerais'),
  ('Assistente de RH'),
  ('Assistente de Produção'),
  ('Assistente de Planejamento / Comercial'),
  ('Assistente de Mídia'),
  ('Assistente de Cage'),
  ('Analista Financeira'),
  ('Analista de Social Mídia Pleno'),
  ('Analista de Conteúdo / Filmmaker'),
  ('Analista de BI'),
  ('PMP')
) as c(nome)
where t.slug = 'agencia-california'
on conflict (tenant_id, nome) do nothing;
