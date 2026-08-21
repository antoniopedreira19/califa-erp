-- =====================================================================
-- Projeto do financeiro + contas bancárias do job (abertura de job)
--
-- Vem do protótipo "Abertura de Job — Financeiro", que acrescenta ao
-- formulário de abertura dois campos que não existiam:
--
--   1. Projeto — editável, com "Criar projeto para este job".
--   2. Conta bancária de recebimento e conta bancária de pagamento.
--
-- ---------------------------------------------------------------------
-- Por que uma tabela nova de projeto, e não uma FK para `projetos`
-- ---------------------------------------------------------------------
--
-- Decisão do Tiago (20/08/2026): a arrumação de projetos que o financeiro
-- faz vale SÓ no financeiro — exatamente como `jobs.nome_financeiro` pode
-- divergir de `jobs.nome`. A produção não pode enxergar essa arrumação.
--
-- Reusar `projetos` entregaria isolamento por FILTRO: o projeto criado
-- pelo financeiro cairia na mesma tabela que alimenta a lista de
-- Orçamentos, e só ficaria escondido enquanto toda tela que lista projeto
-- lembrasse de excluí-lo. Com duas frentes empurrando no mesmo `main`, a
-- primeira tela nova escrita sem o filtro reabre o vazamento sem quebrar
-- nada — ou seja, ninguém percebe. Tabela separada não depende de
-- disciplina.
--
-- Segundo motivo: `projetos` tem quatro colunas NOT NULL que o financeiro
-- não tem por que preencher (`responsavel_id`, `data_inicio_prevista`,
-- `empresa_id`, `cliente_id`). Herdar valor do job para satisfazer
-- constraint é dado inventado, e dado inventado depois é lido como
-- verdade.
--
-- `jobs.projeto_id` continua intocado: é o projeto da produção, nasce do
-- orçamento e segue mandando em Orçamentos e na página de Jobs.
--
-- ---------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------
--
-- Espelha cada `projetos` do tenant em `projetos_financeiro` e aponta
-- todo job para o espelho do seu projeto de produção. O financeiro começa
-- com a MESMA arrumação da produção e rearranja a partir dali — sem isso
-- o combo "Projetos abertos" nasceria vazio para todo job. É backfill que
-- preenche o que estava vazio (coluna recém-criada), então cai no lado
-- aditivo do `docs/FLUXO-BANCO.md`. Nada existente é sobrescrito.
--
-- ---------------------------------------------------------------------
-- Contas bancárias
-- ---------------------------------------------------------------------
--
-- Decisão do Tiago (20/08/2026): UMA conta de recebimento e UMA de
-- pagamento por job — não por parcela. É o que o protótipo desenha (o
-- seletor mora no cabeçalho da seção, não na linha da tabela), então as
-- colunas ficam em `jobs`, e não em `jobs_previsao_recebimento` /
-- `jobs_previsao_custo`.
--
-- Ambas nullable: job aberto antes desta migration não tem conta, e job
-- sem faturamento previsto (cliente paga direto ao fornecedor) não tem
-- por que ter conta de recebimento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. projetos_financeiro
-- ---------------------------------------------------------------------

create table if not exists public.projetos_financeiro (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- Mesmo formato de `projetos.codigo` (CLIENTE-0007/26), gerado por
  -- `lib/codigos/projetos-financeiro.ts`. Sequencial próprio: os dois
  -- espaços de código são independentes de propósito, porque as duas
  -- arrumações divergem.
  codigo text not null,
  nome text not null,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  -- O combo do formulário lista só os ativos ("Projetos abertos").
  ativo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_projetos_financeiro_codigo unique (tenant_id, codigo)
);

create index if not exists idx_projetos_financeiro_tenant
  on public.projetos_financeiro(tenant_id);
-- O combo filtra por cliente do job: só faz sentido agrupar jobs do mesmo
-- cliente sob um projeto.
create index if not exists idx_projetos_financeiro_cliente
  on public.projetos_financeiro(tenant_id, cliente_id)
  where ativo;

drop trigger if exists trg_projetos_financeiro_updated_at
  on public.projetos_financeiro;
create trigger trg_projetos_financeiro_updated_at
  before update on public.projetos_financeiro
  for each row execute function public.set_updated_at();

alter table public.projetos_financeiro enable row level security;

drop policy if exists projetos_financeiro_select on public.projetos_financeiro;
create policy projetos_financeiro_select on public.projetos_financeiro
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists projetos_financeiro_insert on public.projetos_financeiro;
create policy projetos_financeiro_insert on public.projetos_financeiro
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists projetos_financeiro_update on public.projetos_financeiro;
create policy projetos_financeiro_update on public.projetos_financeiro
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem policy de DELETE: projeto do financeiro se inativa (`ativo`), não
-- se apaga — job aberto aponta para ele e a FK é `on delete restrict`.

grant select, insert, update on public.projetos_financeiro to authenticated;

comment on table public.projetos_financeiro is
  'Projeto na visão do financeiro. Espelha `projetos` no início e diverge a partir daí: o financeiro reagrupa seus jobs sem que a produção enxergue. Paralelo de jobs.nome_financeiro vs jobs.nome. Só a aba "Visualizar Jobs" da Abertura de Job agrupa por aqui.';

-- ---------------------------------------------------------------------
-- 2. Colunas em jobs
-- ---------------------------------------------------------------------

alter table public.jobs
  add column if not exists projeto_financeiro_id uuid
    references public.projetos_financeiro(id) on delete restrict;

alter table public.jobs
  add column if not exists conta_recebimento_id uuid
    references public.contas_bancarias(id) on delete restrict;

alter table public.jobs
  add column if not exists conta_pagamento_id uuid
    references public.contas_bancarias(id) on delete restrict;

-- FK que a lista de jobs abertos agrupa: índice obrigatório
-- (`docs/PERFORMANCE.md`).
create index if not exists idx_jobs_projeto_financeiro
  on public.jobs(projeto_financeiro_id);
create index if not exists idx_jobs_conta_recebimento
  on public.jobs(conta_recebimento_id);
create index if not exists idx_jobs_conta_pagamento
  on public.jobs(conta_pagamento_id);

comment on column public.jobs.projeto_financeiro_id is
  'Projeto do job na visão do financeiro. Independente de projeto_id, que é o da produção e continua vindo do orçamento.';
comment on column public.jobs.conta_recebimento_id is
  'Conta bancária em que o faturamento deste job entra. Escolhida na abertura, uma para o job inteiro.';
comment on column public.jobs.conta_pagamento_id is
  'Conta bancária de onde os custos deste job saem. Escolhida na abertura, uma para o job inteiro.';

-- ---------------------------------------------------------------------
-- 3. Backfill — espelho da arrumação da produção
-- ---------------------------------------------------------------------

insert into public.projetos_financeiro (tenant_id, codigo, nome, cliente_id, created_by)
select p.tenant_id, p.codigo, p.nome, p.cliente_id, p.created_by
from public.projetos p
on conflict (tenant_id, codigo) do nothing;

-- Só onde está vazio: nunca sobrescreve escolha já feita.
update public.jobs j
set projeto_financeiro_id = pf.id
from public.projetos p
join public.projetos_financeiro pf
  on pf.tenant_id = p.tenant_id and pf.codigo = p.codigo
where j.projeto_id = p.id
  and j.projeto_financeiro_id is null;
