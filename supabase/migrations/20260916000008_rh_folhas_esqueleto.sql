-- =====================================================================
-- RH — Fase 7: esqueleto das tabelas de folha (Camada 2)
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Cria as tabelas mínimas para a Camada 2 do modelo (snapshot da folha
-- por competência). **Nada é escrito nelas no MVP** — nascem vazias e
-- só têm RLS+GRANT. Existem para que o motor da folha (fase futura)
-- encaixe sem forçar refactor destrutivo em cima do módulo já em uso.
--
-- ATENÇÃO ao ler este arquivo
--
-- Estas tabelas são um COMPROMISSO explícito com a decisão do MVP:
--   • folhas_pagamento           — cabeçalho por (colaborador, competência)
--   • folhas_pagamento_alocacoes — snapshot da alocação usada no rateio
--
-- O status vem como TEXT (não enum). Vai virar enum próprio na fase da
-- folha, quando os valores realmente forem usados (rascunho, enviada,
-- aprovada, paga). No MVP fica text porque nenhuma linha existe — sem
-- risco de dado antigo travando futura migração de tipo.
--
-- Regra de soma=100 do snapshot NÃO é enforçada aqui — ninguém escreve
-- nesta tabela ainda. Quando o motor da folha existir, uma migration
-- adicional cria a trigger deferrable (análoga à de
-- colaboradores_alocacoes) sobre folhas_pagamento_alocacoes.
--
-- Dependências:
--   • public.tenants, public.colaboradores, public.empresas,
--     public.regionais, public.profiles
--   • public.is_tenant_admin(uuid), public.is_tenant_rh(uuid)
--
-- Aditivo do começo ao fim: nenhuma tabela existente é modificada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. folhas_pagamento
-- ---------------------------------------------------------------------

create table if not exists public.folhas_pagamento (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  colaborador_id     uuid not null references public.colaboradores(id) on delete restrict,

  competencia_ano    smallint not null,
  competencia_mes    smallint not null,

  salario_base       numeric(14,2) not null,

  status             text not null default 'rascunho',

  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint chk_folhas_competencia_mes_valido check (competencia_mes between 1 and 12),
  constraint chk_folhas_competencia_ano_valido check (competencia_ano between 2020 and 2099),
  constraint chk_folhas_salario_positivo       check (salario_base > 0)
);

create unique index if not exists uniq_folha_por_colaborador_competencia
  on public.folhas_pagamento (colaborador_id, competencia_ano, competencia_mes);

create index if not exists idx_folhas_tenant on public.folhas_pagamento (tenant_id);

comment on table public.folhas_pagamento is
  'Camada 2 — snapshot da folha por competencia. ESQUELETO no MVP; motor da folha e fase futura. Nao ha UI escrevendo aqui ainda. status virara enum quando a fase da folha for implementada.';

drop trigger if exists trg_folhas_updated_at on public.folhas_pagamento;
create trigger trg_folhas_updated_at
  before update on public.folhas_pagamento
  for each row execute function public.set_updated_at();

alter table public.folhas_pagamento enable row level security;

drop policy if exists folhas_select on public.folhas_pagamento;
create policy folhas_select on public.folhas_pagamento
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists folhas_insert on public.folhas_pagamento;
create policy folhas_insert on public.folhas_pagamento
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists folhas_update on public.folhas_pagamento;
create policy folhas_update on public.folhas_pagamento
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

grant select, insert, update on public.folhas_pagamento to authenticated;


-- ---------------------------------------------------------------------
-- 2. folhas_pagamento_alocacoes
-- ---------------------------------------------------------------------

create table if not exists public.folhas_pagamento_alocacoes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  folha_id           uuid not null references public.folhas_pagamento(id) on delete cascade,

  empresa_id         uuid not null references public.empresas(id) on delete restrict,
  regional_id        uuid not null references public.regionais(id) on delete restrict,
  percentual         numeric(5,2) not null,

  created_at         timestamptz not null default now(),

  constraint chk_folha_aloc_percentual_valido check (percentual > 0 and percentual <= 100)
);

create index if not exists idx_folha_aloc_folha    on public.folhas_pagamento_alocacoes (folha_id);
create index if not exists idx_folha_aloc_empresa  on public.folhas_pagamento_alocacoes (empresa_id);
create index if not exists idx_folha_aloc_regional on public.folhas_pagamento_alocacoes (regional_id);

comment on table public.folhas_pagamento_alocacoes is
  'Snapshot da alocacao (Camada 1) usada no rateio da folha. Nasce copiando colaboradores_alocacoes vigentes; editavel pelo financeiro antes de aprovar. ESQUELETO no MVP. Constraint trigger de soma=100 sera adicionada quando o motor da folha for implementado.';

alter table public.folhas_pagamento_alocacoes enable row level security;

drop policy if exists folha_aloc_select on public.folhas_pagamento_alocacoes;
create policy folha_aloc_select on public.folhas_pagamento_alocacoes
  for select to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists folha_aloc_insert on public.folhas_pagamento_alocacoes;
create policy folha_aloc_insert on public.folhas_pagamento_alocacoes
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists folha_aloc_update on public.folhas_pagamento_alocacoes;
create policy folha_aloc_update on public.folhas_pagamento_alocacoes
  for update to authenticated
  using  (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

grant select, insert, update on public.folhas_pagamento_alocacoes to authenticated;
