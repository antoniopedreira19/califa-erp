-- Subsistema "Vínculos de Colaborador" — Fase 1, Sessão S1 (fundação).
-- Spec: docs/modulos/rh/70-vinculos-colaborador.md
-- Modelo: docs/modulos/rh/71-vinculos-colaborador-modelo-de-dados.md
-- Plano: docs/modulos/rh/72-vinculos-colaborador-plano-de-execucao.md §S1
--
-- Esta migration é **aditiva e invisível**:
--   - Cria enum vinculo_motivo_encerramento.
--   - Cria tabela colaborador_vinculos (vazia, sem backfill).
--   - Cria policies RLS + GRANT pra authenticated.
--   - Cria índices + unique parcial (1 vínculo ativo por colaborador).
--   - Cria trigger de validação de overlap.
--   - Cria função helper fn_data_base_ferias (pra S3 usar).
--
-- Sem backfill, sem mudança comportamental. Nenhuma query existente
-- precisa mudar. S2 faz o backfill, S3 muda a trigger de férias.

-- ============================================================
-- 1. Enum do motivo de encerramento
-- ============================================================
create type public.vinculo_motivo_encerramento as enum (
  'rescisao_clt_para_novo_vinculo',  -- típico das viradas CLT → PJ
  'demissao',
  'pedido_demissao',
  'fim_de_contrato',                 -- ex: estágio terminou
  'outro'
);

-- ============================================================
-- 2. Tabela colaborador_vinculos
-- ============================================================
create table public.colaborador_vinculos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  colaborador_id        uuid not null references public.colaboradores(id) on delete cascade,
  tipo_contratacao      public.tipo_contratacao not null,
  data_inicio           date not null,
  data_fim              date,
  motivo_encerramento   public.vinculo_motivo_encerramento,
  vinculo_anterior_id   uuid references public.colaborador_vinculos(id) on delete set null,
  observacao            text,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint chk_vinculo_datas       check (data_fim is null or data_fim >= data_inicio),
  constraint chk_motivo_so_encerrado check (
    (data_fim is null and motivo_encerramento is null)
    or (data_fim is not null)
  )
);

comment on table public.colaborador_vinculos is
  'Histórico de vínculos trabalhistas de um colaborador. Um colaborador pode ter N vínculos ao longo do tempo (ex: CLT 2024, PJ 2024→vigente após rescisão). Vínculo ativo = data_fim is null. Spec: docs/modulos/rh/70-vinculos-colaborador.md';

-- ============================================================
-- 3. Índices
-- ============================================================
create index idx_colab_vinculos_tenant_colab
  on public.colaborador_vinculos(tenant_id, colaborador_id);

create index idx_colab_vinculos_ativo
  on public.colaborador_vinculos(colaborador_id)
  where data_fim is null;

create index idx_colab_vinculos_anterior
  on public.colaborador_vinculos(vinculo_anterior_id)
  where vinculo_anterior_id is not null;

-- Unique parcial: no máximo 1 vínculo ativo por colaborador
create unique index uniq_colab_vinculo_ativo
  on public.colaborador_vinculos(colaborador_id)
  where data_fim is null;

-- ============================================================
-- 4. Trigger de validação de overlap entre vínculos do mesmo colab
-- ============================================================
-- A unique parcial garante 1 ativo. Mas 2 encerrados podem ser
-- cadastrados sobrepondo datas erroneamente. Trigger impede.

create or replace function public.fn_vinculo_valida_overlap()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.colaborador_vinculos v
    where v.colaborador_id = new.colaborador_id
      and v.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and v.data_inicio <= coalesce(new.data_fim, 'infinity'::date)
      and coalesce(v.data_fim, 'infinity'::date) >= new.data_inicio
  ) then
    raise exception 'Já existe vínculo deste colaborador sobrepondo o período informado.';
  end if;
  return new;
end $$;

create trigger trg_vinculo_valida_overlap
  before insert or update on public.colaborador_vinculos
  for each row execute function public.fn_vinculo_valida_overlap();

-- ============================================================
-- 5. updated_at automático
-- ============================================================
create or replace function public.fn_colab_vinculos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_colab_vinculos_updated_at
  before update on public.colaborador_vinculos
  for each row execute function public.fn_colab_vinculos_updated_at();

-- ============================================================
-- 6. Função helper: data base de contagem de férias
-- ============================================================
-- Usada pela trigger fn_gerar_ferias_periodos (a ser atualizada em S3).
-- Retorna data_inicio do vínculo ativo; fallback pro valor passado
-- (geralmente data_admissao) se o colaborador não tem vínculo ainda
-- (edge case durante backfill ou criação de colab novo).

create or replace function public.fn_data_base_ferias(
  p_colaborador_id uuid,
  p_fallback date
)
returns date
language sql
stable
as $$
  select coalesce(
    (
      select data_inicio from public.colaborador_vinculos
       where colaborador_id = p_colaborador_id
         and data_fim is null
       limit 1
    ),
    p_fallback
  );
$$;

comment on function public.fn_data_base_ferias(uuid, date) is
  'Data base de contagem de aquisitivos de férias: data_inicio do vínculo ativo do colaborador, ou fallback (geralmente data_admissao).';

-- ============================================================
-- 7. RLS + GRANT
-- ============================================================
alter table public.colaborador_vinculos enable row level security;

-- admin + rh lêem tudo do tenant; colaborador lê só o próprio
create policy vinculos_select on public.colaborador_vinculos
  for select to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or exists (
      select 1 from public.colaboradores c
       where c.id = colaborador_id
         and c.user_id = (select auth.uid())
    )
  );

create policy vinculos_insert on public.colaborador_vinculos
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id)
  );

create policy vinculos_update on public.colaborador_vinculos
  for update to authenticated
  using (
    public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id)
  );

create policy vinculos_delete on public.colaborador_vinculos
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
  );

grant select, insert, update, delete
  on public.colaborador_vinculos
  to authenticated;
