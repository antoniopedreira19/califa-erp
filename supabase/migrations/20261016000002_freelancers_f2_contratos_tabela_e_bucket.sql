-- Task 015 — Freelancers (Fase 2, Task 1): tabela de contratos + bucket Storage
--
-- Cria a estrutura de banco pra Fase 2: `freelancer_contratos` + bucket
-- Storage pra DOCX de minuta, PDF assinado, distrato e cartão CNPJ.
-- Nenhuma view, trigger de histórico, UI ou geração de arquivo nasce aqui.
--
-- Decisões (travadas em alinhamento 16/10/2026):
--   * `job_id` é FK pra `jobs(id)` do califa-erp. Nullable no banco porque
--     contratos legados (migrados do AgCaliforniaRH, Fase 5) não têm job
--     real. Check constraint força: novos contratos (origem='califa_erp')
--     exigem job_id; legados aceitam null.
--   * `nome_job` é snapshot do nome do job no momento do cadastro. O job
--     real pode ser renomeado depois sem alterar o contrato existente.
--   * `responsavel_id` é FK pra profiles — qualquer usuário serve do ponto
--     de vista do banco. Restringir ao conjunto {gerente_producao,
--     financeiro, rh, produtor, administrador} fica na UI nesta task.
--     Endurecimento via trigger pode vir numa task futura.
--   * `tipo` controla só a redação do DOCX (mensal/periodo/diarias).
--   * Distrato: campos de snapshot (data_termino_original) + arquivos
--     (minuta/assinado) + metadados (data proposta, motivo, quem/quando
--     pediu). Aplicar o distrato = anexar distrato_arquivo_url (lógica
--     na action/trigger a ser criada em task futura).
--   * origem_sistema distingue califa_erp vs ag_california_rh (migrado).
--
-- RLS:
--   contratos: todos tenant_members leem; admin/rh/financeiro escrevem;
--   admin/rh deletam.
--
-- Bucket:
--   freelancer-arquivos privado. SELECT pra tenant_members; INSERT/UPDATE/
--   DELETE pra admin/rh/financeiro (GP não sobe arquivo direto —
--   fluxo passa por solicitação, Fase 3).
--
-- Paths esperados no bucket:
--   {tenant_id}/contratos/{contrato_id}/minuta.docx
--   {tenant_id}/contratos/{contrato_id}/assinado.pdf
--   {tenant_id}/contratos/{contrato_id}/distrato-minuta.docx
--   {tenant_id}/contratos/{contrato_id}/distrato-assinado.pdf
--   {tenant_id}/freelancers/{freelancer_id}/cartao-cnpj.{ext}

-- ---------- TABELA: freelancer_contratos ----------
create table if not exists public.freelancer_contratos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Vínculos
  freelancer_id uuid not null references public.freelancers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  responsavel_id uuid references public.profiles(id) on delete set null,

  -- Dados do contrato (snapshot do que foi assinado)
  nome_job text not null,
  cargo text,
  tipo text not null,
  valor numeric(14, 2) not null,
  data_inicio date,
  data_termino date,
  cidade text,
  observacoes text,

  -- Operacional
  status_real boolean not null default true,
  arquivo_url text,
  minuta_url text,

  -- Distrato (antecipação de término)
  data_termino_original date,
  distrato_minuta_url text,
  distrato_arquivo_url text,
  distrato_data_proposta date,
  distrato_motivo text,
  distrato_solicitado_em timestamptz,
  distrato_solicitado_por uuid references public.profiles(id) on delete set null,

  -- Origem
  origem_sistema text not null default 'califa_erp',

  -- Auditoria
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,

  -- Checks
  constraint freelancer_contratos_tipo_check
    check (tipo in ('mensal', 'periodo', 'diarias')),
  constraint freelancer_contratos_origem_check
    check (origem_sistema in ('califa_erp', 'ag_california_rh')),
  constraint freelancer_contratos_job_obrigatorio_em_novos
    check (origem_sistema = 'ag_california_rh' or job_id is not null),
  constraint freelancer_contratos_termino_apos_inicio
    check (
      data_termino is null
      or data_inicio is null
      or data_termino >= data_inicio
    ),
  constraint freelancer_contratos_valor_positivo
    check (valor >= 0)
);

comment on table public.freelancer_contratos is
  'Contratos de freelancer. Vinculados a um freelancer (sempre) e a um job real do califa-erp (obrigatório em novos, null em legados).';

-- ---------- Índices ----------
create index if not exists idx_freelancer_contratos_tenant
  on public.freelancer_contratos (tenant_id);

create index if not exists idx_freelancer_contratos_freelancer
  on public.freelancer_contratos (freelancer_id);

create index if not exists idx_freelancer_contratos_job
  on public.freelancer_contratos (job_id)
  where job_id is not null;

create index if not exists idx_freelancer_contratos_responsavel
  on public.freelancer_contratos (responsavel_id)
  where responsavel_id is not null;

create index if not exists idx_freelancer_contratos_tenant_termino
  on public.freelancer_contratos (tenant_id, data_termino);

create index if not exists idx_freelancer_contratos_tenant_status_real
  on public.freelancer_contratos (tenant_id, status_real);

-- Covering indexes nas FKs opcionais (advisor flagou nas tasks anteriores)
create index if not exists idx_freelancer_contratos_created_by
  on public.freelancer_contratos (created_by)
  where created_by is not null;

create index if not exists idx_freelancer_contratos_updated_by
  on public.freelancer_contratos (updated_by)
  where updated_by is not null;

create index if not exists idx_freelancer_contratos_distrato_solicitado_por
  on public.freelancer_contratos (distrato_solicitado_por)
  where distrato_solicitado_por is not null;

-- ---------- RLS ----------
alter table public.freelancer_contratos enable row level security;

create policy freelancer_contratos_select on public.freelancer_contratos
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy freelancer_contratos_insert on public.freelancer_contratos
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

create policy freelancer_contratos_update on public.freelancer_contratos
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

create policy freelancer_contratos_delete on public.freelancer_contratos
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

-- Trigger de updated_at
drop trigger if exists trg_freelancer_contratos_updated_at on public.freelancer_contratos;
create trigger trg_freelancer_contratos_updated_at
  before update on public.freelancer_contratos
  for each row execute function public.set_updated_at();

-- Grants
grant select, insert, update, delete on public.freelancer_contratos to authenticated;
revoke all on public.freelancer_contratos from anon;

-- ---------- BUCKET: freelancer-arquivos ----------
insert into storage.buckets (id, name, public)
values ('freelancer-arquivos', 'freelancer-arquivos', false)
on conflict (id) do nothing;

-- Policies do bucket — tenant_id vem do primeiro segmento do path.
-- Padrão idêntico aos buckets `colaboradores-nf` e `pedidos-compra`.
create policy freelancer_arquivos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'freelancer-arquivos'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

create policy freelancer_arquivos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'freelancer-arquivos'
    and (
      public.is_tenant_admin((split_part(name, '/', 1))::uuid)
      or public.is_tenant_rh((split_part(name, '/', 1))::uuid)
      or public.is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  );

create policy freelancer_arquivos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'freelancer-arquivos'
    and (
      public.is_tenant_admin((split_part(name, '/', 1))::uuid)
      or public.is_tenant_rh((split_part(name, '/', 1))::uuid)
      or public.is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  )
  with check (
    bucket_id = 'freelancer-arquivos'
    and (
      public.is_tenant_admin((split_part(name, '/', 1))::uuid)
      or public.is_tenant_rh((split_part(name, '/', 1))::uuid)
      or public.is_tenant_financeiro((split_part(name, '/', 1))::uuid)
    )
  );

create policy freelancer_arquivos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'freelancer-arquivos'
    and (
      public.is_tenant_admin((split_part(name, '/', 1))::uuid)
      or public.is_tenant_rh((split_part(name, '/', 1))::uuid)
    )
  );
