-- =====================================================================
-- Contatos do job (Tela 1.6 — modal "Enviar job para abertura").
--
-- POR QUE EXISTE: o financeiro precisa saber A QUEM cobrar no cliente, e
-- isso é decidido por quem envia o job para abertura — não está no
-- cadastro do cliente, porque muda de job para job (evento, praça,
-- área do cliente que aprovou a verba). Enviar o job passa a exigir ao
-- menos um contato de cobrança.
--
-- POR QUE TABELA E NÃO COLUNA: são N contatos por job, cada um com nome,
-- e-mail e telefone. Coluna jsonb em `jobs` resolveria a gravação, mas
-- não a leitura do financeiro (filtrar/ordenar por contato) nem a
-- integridade de "e-mail obrigatório" — que aqui é constraint, não
-- convenção de quem escreve o JSON.
--
-- `tipo` já nasce com CHECK aceitando 'pagamento' além de 'cobranca'.
-- Hoje a aplicação grava SÓ 'cobranca' (contato de pagamento foi
-- descartado nesta entrega); o valor extra no CHECK evita nova migration
-- se ele voltar. Não é enum de propósito: enum novo obriga migration
-- isolada para cada valor futuro.
--
-- FICOU DE FORA, deliberadamente:
--   - GRANT de DELETE. Nenhum fluxo apaga contato: a lixeira do modal
--     remove linha do formulário ANTES de existir job. Quando surgir
--     tela de edição de contatos, a migration dela adiciona o grant e a
--     policy de delete.
--   - Vínculo com `clientes` / contatos do cadastro. O contato é do JOB,
--     digitado na abertura; herdar do cliente é decisão futura.
-- =====================================================================

create table if not exists public.jobs_contatos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  tipo       text not null,
  nome       text not null,
  -- Telefone é opcional: nem todo contato de cobrança do cliente tem um.
  -- A aplicação grava null quando o campo vem vazio (nunca string vazia).
  numero     text,
  email      text not null,
  -- Posição no formulário, para o financeiro ler na ordem em que a
  -- produção digitou (o primeiro é o contato principal na prática).
  ordem      int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),

  constraint chk_jobs_contatos_tipo check (tipo in ('cobranca', 'pagamento')),
  constraint chk_jobs_contatos_nome check (length(trim(nome)) >= 2),
  -- Guarda mínima de formato: o Zod valida o e-mail de verdade no
  -- servidor; aqui o banco só recusa string vazia ou sem "@".
  constraint chk_jobs_contatos_email check (position('@' in email) > 1),
  constraint chk_jobs_contatos_numero check (numero is null or length(trim(numero)) > 0)
);

-- FK filtrada em toda leitura do job (regra de docs/PERFORMANCE.md).
-- O índice cobre `where job_id = ?` e `order by ordem`.
create index if not exists idx_jobs_contatos_job
  on public.jobs_contatos(job_id, ordem);
create index if not exists idx_jobs_contatos_tenant
  on public.jobs_contatos(tenant_id);

drop trigger if exists trg_jobs_contatos_updated_at on public.jobs_contatos;
create trigger trg_jobs_contatos_updated_at
before update on public.jobs_contatos
for each row execute function public.set_updated_at();

-- RLS + GRANT (RLS != GRANT: sem o grant, `authenticated` toma
-- "permission denied" mesmo com policy correta).
alter table public.jobs_contatos enable row level security;

drop policy if exists jobs_contatos_select on public.jobs_contatos;
create policy jobs_contatos_select on public.jobs_contatos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists jobs_contatos_insert on public.jobs_contatos;
create policy jobs_contatos_insert on public.jobs_contatos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists jobs_contatos_update on public.jobs_contatos;
create policy jobs_contatos_update on public.jobs_contatos
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.jobs_contatos to authenticated;
-- Nada para `anon`, em nenhuma hipótese.

comment on table public.jobs_contatos is
  'Contatos do job informados na abertura. Hoje só tipo=cobranca: quem recebe a cobrança no cliente.';
