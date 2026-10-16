-- Task 020 — Freelancers (Fase 3, Task 1): tabelas de solicitação + chat + realtime
--
-- Fundação de banco pra Fase 3. Cria:
--   1. Enum `freelancer_solicitacao_status`.
--   2. `freelancer_solicitacoes` — pedido de contratação feito pelo GP
--      (ou qualquer solicitante autorizado). Status: pendente → aprovada
--      → cadastrada (ou rejeitada / cancelada).
--   3. `freelancer_solicitacao_mensagens` — chat GP↔RH dentro de cada
--      solicitação. Realtime habilitado.
--   4. `freelancer_solicitacao_mensagens_leituras` — carimbo de leitura
--      por usuário pra badge de não lidas.
--   5. RPC `get_freelancer_solicitacao_mensagens_nao_lidas()`.
--
-- Decisões:
--   * `token` em `freelancer_solicitacoes` é gerado via pgcrypto; freela
--     usa /form/freelancer-solicitacao/<token> pra preencher dados sem
--     login.
--   * `job_id` é NOT NULL — a solicitação só nasce amarrada a um job
--     real já existente. Isso simplifica o fluxo e a view de contrato
--     futura (contrato criado pelo submit terá job_id obrigatório, bate
--     com check constraint da Task 015).
--   * SELECT da solicitação: admin/rh/financeiro veem todas; demais só
--     as próprias.
--   * UPDATE da solicitação: todo mundo com acesso vê e pode atualizar
--     via server action. As transições de status válidas (aprovar/
--     rejeitar/cancelar/cadastrar) são enforçadas na UI + actions, não
--     no banco. Simplifica RLS; audit cobre o restante.
--   * DELETE desabilitado — soft via status=cancelada.
--   * Realtime só em mensagens (não em solicitações) — chat é a parte
--     colaborativa; solicitação atualiza via revalidatePath.

-- ---------- ENUM ----------
do $$ begin
  create type freelancer_solicitacao_status as enum (
    'pendente',
    'aprovada',
    'rejeitada',
    'cadastrada',
    'cancelada'
  );
exception
  when duplicate_object then null;
end $$;

-- ---------- TABELA: freelancer_solicitacoes ----------
create table if not exists public.freelancer_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Chave pública segura usada no link que o freela recebe
  token text not null unique default encode(gen_random_bytes(16), 'hex'),

  -- Quem criou a solicitação (GP, Produtor, etc.)
  solicitante_id uuid not null references public.profiles(id) on delete set null,

  -- Dados do freela proposto
  nome_freela text not null,
  cpf_freela text,

  -- Dados do contrato pré-aprovado
  job_id uuid not null references public.jobs(id) on delete restrict,
  cargo text,
  valor numeric(14, 2) not null,
  tipo text not null,
  data_inicio date,
  data_termino date,
  cidade text,
  observacoes text,

  -- Status + metadados
  status freelancer_solicitacao_status not null default 'pendente',
  aprovado_por uuid references public.profiles(id) on delete set null,
  aprovado_em timestamptz,
  expira_em timestamptz,
  rejeitado_por uuid references public.profiles(id) on delete set null,
  rejeitado_em timestamptz,
  rejeicao_motivo text,
  cancelado_por uuid references public.profiles(id) on delete set null,
  cancelado_em timestamptz,

  -- Resultado do cadastro (preenchido quando status=cadastrada)
  freelancer_id uuid references public.freelancers(id) on delete set null,
  contrato_id uuid references public.freelancer_contratos(id) on delete set null,

  -- Auditoria
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Checks
  constraint freelancer_solicitacoes_tipo_check
    check (tipo in ('mensal', 'periodo', 'diarias')),
  constraint freelancer_solicitacoes_valor_positivo
    check (valor >= 0),
  constraint freelancer_solicitacoes_termino_apos_inicio
    check (
      data_termino is null
      or data_inicio is null
      or data_termino >= data_inicio
    )
);

comment on table public.freelancer_solicitacoes is
  'Solicitação de contratação de freelancer. GP (ou outro solicitante) pede, RH aprova, freela usa o token pra preencher dados pessoais, sistema cria freelancer + contrato atomicamente (origem_sistema=califa_erp).';

create index if not exists idx_freelancer_solicitacoes_tenant
  on public.freelancer_solicitacoes (tenant_id);
create index if not exists idx_freelancer_solicitacoes_solicitante
  on public.freelancer_solicitacoes (solicitante_id);
create index if not exists idx_freelancer_solicitacoes_job
  on public.freelancer_solicitacoes (job_id);
create index if not exists idx_freelancer_solicitacoes_tenant_status
  on public.freelancer_solicitacoes (tenant_id, status, created_at desc);
create index if not exists idx_freelancer_solicitacoes_solicitante_status
  on public.freelancer_solicitacoes (solicitante_id, status, created_at desc);
create index if not exists idx_freelancer_solicitacoes_freelancer
  on public.freelancer_solicitacoes (freelancer_id)
  where freelancer_id is not null;
create index if not exists idx_freelancer_solicitacoes_contrato
  on public.freelancer_solicitacoes (contrato_id)
  where contrato_id is not null;
create index if not exists idx_freelancer_solicitacoes_aprovado_por
  on public.freelancer_solicitacoes (aprovado_por)
  where aprovado_por is not null;
create index if not exists idx_freelancer_solicitacoes_rejeitado_por
  on public.freelancer_solicitacoes (rejeitado_por)
  where rejeitado_por is not null;
create index if not exists idx_freelancer_solicitacoes_cancelado_por
  on public.freelancer_solicitacoes (cancelado_por)
  where cancelado_por is not null;

alter table public.freelancer_solicitacoes enable row level security;

create policy freelancer_solicitacoes_select on public.freelancer_solicitacoes
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      public.is_tenant_admin(tenant_id)
      or public.is_tenant_rh(tenant_id)
      or public.is_tenant_financeiro(tenant_id)
      or solicitante_id = (select auth.uid())
    )
  );

create policy freelancer_solicitacoes_insert on public.freelancer_solicitacoes
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and solicitante_id = (select auth.uid())
    and status = 'pendente'
  );

create policy freelancer_solicitacoes_update on public.freelancer_solicitacoes
  for update to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
    or solicitante_id = (select auth.uid())
  )
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
    or solicitante_id = (select auth.uid())
  );

drop trigger if exists trg_freelancer_solicitacoes_updated_at on public.freelancer_solicitacoes;
create trigger trg_freelancer_solicitacoes_updated_at
  before update on public.freelancer_solicitacoes
  for each row execute function public.set_updated_at();

grant select, insert, update on public.freelancer_solicitacoes to authenticated;
revoke all on public.freelancer_solicitacoes from anon;

-- ---------- TABELA: freelancer_solicitacao_mensagens ----------
create table if not exists public.freelancer_solicitacao_mensagens (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.freelancer_solicitacoes(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  texto text not null,
  created_at timestamptz not null default now(),
  constraint freelancer_solicitacao_mensagens_texto_tamanho
    check (char_length(texto) between 1 and 2000)
);

create index if not exists idx_freelancer_solicitacao_mensagens_solicitacao
  on public.freelancer_solicitacao_mensagens (solicitacao_id, created_at);
create index if not exists idx_freelancer_solicitacao_mensagens_autor
  on public.freelancer_solicitacao_mensagens (autor_id)
  where autor_id is not null;

alter table public.freelancer_solicitacao_mensagens enable row level security;

-- SELECT: pode ler quem pode ler a solicitação subjacente
create policy freelancer_solicitacao_mensagens_select on public.freelancer_solicitacao_mensagens
  for select to authenticated
  using (
    exists (
      select 1 from public.freelancer_solicitacoes s
      where s.id = solicitacao_id
    )
  );

create policy freelancer_solicitacao_mensagens_insert on public.freelancer_solicitacao_mensagens
  for insert to authenticated
  with check (
    autor_id = (select auth.uid())
    and exists (
      select 1 from public.freelancer_solicitacoes s
      where s.id = solicitacao_id
    )
  );

grant select, insert on public.freelancer_solicitacao_mensagens to authenticated;
revoke all on public.freelancer_solicitacao_mensagens from anon;

-- Realtime
do $$ begin
  alter publication supabase_realtime add table public.freelancer_solicitacao_mensagens;
exception
  when duplicate_object then null;
end $$;

-- ---------- TABELA: freelancer_solicitacao_mensagens_leituras ----------
create table if not exists public.freelancer_solicitacao_mensagens_leituras (
  solicitacao_id uuid not null references public.freelancer_solicitacoes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (solicitacao_id, user_id)
);

create index if not exists idx_freelancer_solicitacao_leituras_user
  on public.freelancer_solicitacao_mensagens_leituras (user_id);

alter table public.freelancer_solicitacao_mensagens_leituras enable row level security;

create policy freelancer_leituras_select on public.freelancer_solicitacao_mensagens_leituras
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy freelancer_leituras_insert on public.freelancer_solicitacao_mensagens_leituras
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy freelancer_leituras_update on public.freelancer_solicitacao_mensagens_leituras
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.freelancer_solicitacao_mensagens_leituras to authenticated;
revoke all on public.freelancer_solicitacao_mensagens_leituras from anon;

-- ---------- RPC: get_freelancer_solicitacao_mensagens_nao_lidas ----------
create or replace function public.get_freelancer_solicitacao_mensagens_nao_lidas()
returns table (solicitacao_id uuid, nao_lidas bigint)
language sql
security invoker
stable
as $$
  select
    m.solicitacao_id,
    count(*)::bigint as nao_lidas
  from public.freelancer_solicitacao_mensagens m
  left join public.freelancer_solicitacao_mensagens_leituras l
    on l.solicitacao_id = m.solicitacao_id
    and l.user_id = auth.uid()
  where m.autor_id is distinct from auth.uid()
    and (l.last_read_at is null or m.created_at > l.last_read_at)
  group by m.solicitacao_id;
$$;

grant execute on function public.get_freelancer_solicitacao_mensagens_nao_lidas() to authenticated;
