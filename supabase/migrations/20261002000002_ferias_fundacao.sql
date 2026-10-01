-- Motivo: fundação do subsistema de Férias — adiciona colaboradores.user_id,
-- cria enum ferias_periodo_status, tabela colaboradores_ferias_periodos,
-- helper is_colaborador_proprio e trigger de geração automática dos períodos
-- aquisitivos a partir da data_admissao.
--
-- Referências:
--   - docs/modulos/rh/25-ferias.md (spec de negócio)
--   - docs/modulos/rh/26-ferias-modelo-de-dados.md §1, §2, §3, §3.5
--   - docs/modulos/rh/27-ferias-plano-de-execucao.md S1
--
-- Decisões incorporadas:
--   - colaboradores.user_id é adicionado agora (não existia no banco).
--   - Geração de períodos: data_admissao → current_date + 2 anos (não "5 fixo").
--   - Status 'em_alerta' calculado quando concessivo_fim − hoje ≤ 60 dias (F14).
--
-- Esta migration é NÃO-DESTRUTIVA: só adiciona objetos novos.

-- ===========================================================================
-- 1. colaboradores.user_id — vínculo opcional com auth.users
-- ===========================================================================

alter table public.colaboradores
  add column if not exists user_id uuid references auth.users(id) on delete set null;

comment on column public.colaboradores.user_id is
  'Vínculo opcional com auth.users. Populado quando o colaborador recebe acesso ao sistema (role colaborador). Nullable porque: (a) nem todo colaborador precisa de login, (b) admin pode não ser colaborador.';

create unique index if not exists uniq_colaboradores_user_id
  on public.colaboradores (user_id)
  where user_id is not null;

-- ===========================================================================
-- 2. Helper RLS: is_colaborador_proprio(colaborador_id)
-- ===========================================================================

create or replace function public.is_colaborador_proprio(p_colaborador_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.colaboradores c
     where c.id = p_colaborador_id
       and c.user_id = (select auth.uid())
  );
$$;

comment on function public.is_colaborador_proprio is
  'True se o colaborador cujo id é p_colaborador_id está vinculado ao usuário autenticado atual. Usado em RLS do subsistema de Férias para isolar leitura/escrita do próprio colaborador.';

-- ===========================================================================
-- 3. Enum ferias_periodo_status
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ferias_periodo_status') then
    create type public.ferias_periodo_status as enum (
      'incompleto',
      'apto',
      'em_alerta',
      'vencido',
      'regularizado',
      'nao_habilitado',
      'pago_rescisao'
    );
  end if;
end$$;

comment on type public.ferias_periodo_status is
  'Status derivado de cada período aquisitivo. Armazenado para performance; recalculado por fn_recalcular_status_periodo e por job diário.';

-- ===========================================================================
-- 4. Função genérica fn_set_updated_at (se ainda não existir)
-- ===========================================================================

create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 5. Tabela colaboradores_ferias_periodos
-- ===========================================================================

create table if not exists public.colaboradores_ferias_periodos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  numero int not null,
  aquisitivo_inicio date not null,
  aquisitivo_fim date not null,
  concessivo_inicio date not null,
  concessivo_fim date not null,
  dias_direito int not null default 30 check (dias_direito between 0 and 30),
  status public.ferias_periodo_status not null default 'incompleto',
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_ferias_periodo_colab_numero
    unique (colaborador_id, numero),
  constraint chk_ferias_periodo_datas
    check (
      aquisitivo_fim > aquisitivo_inicio
      and concessivo_inicio > aquisitivo_fim
      and concessivo_fim > concessivo_inicio
    )
);

comment on table public.colaboradores_ferias_periodos is
  'Períodos aquisitivos + concessivos de cada colaborador. Gerados automaticamente a partir de data_admissao via trigger. Status é derivado mas armazenado pra performance de leitura.';

comment on column public.colaboradores_ferias_periodos.numero is
  'Ordem cronológica: 1 = primeiro período (admissão + 1 ano), 2 = segundo etc.';

comment on column public.colaboradores_ferias_periodos.dias_direito is
  'Padrão 30. Campo existe pra permitir casos excepcionais (ex: proporcional ao sair, redução por falta — não usado no MVP).';

-- Índices
create index if not exists idx_ferias_periodos_colaborador
  on public.colaboradores_ferias_periodos (colaborador_id);

create index if not exists idx_ferias_periodos_tenant_status
  on public.colaboradores_ferias_periodos (tenant_id, status);

create index if not exists idx_ferias_periodos_concessivo_fim
  on public.colaboradores_ferias_periodos (concessivo_fim)
  where status in ('apto', 'em_alerta');

-- Trigger de updated_at
drop trigger if exists trg_ferias_periodos_updated_at on public.colaboradores_ferias_periodos;
create trigger trg_ferias_periodos_updated_at
  before update on public.colaboradores_ferias_periodos
  for each row execute function public.fn_set_updated_at();

-- RLS
alter table public.colaboradores_ferias_periodos enable row level security;

drop policy if exists ferias_periodos_rh_admin_all on public.colaboradores_ferias_periodos;
create policy ferias_periodos_rh_admin_all on public.colaboradores_ferias_periodos
  for all to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists ferias_periodos_colab_read_own on public.colaboradores_ferias_periodos;
create policy ferias_periodos_colab_read_own on public.colaboradores_ferias_periodos
  for select to authenticated
  using (public.is_colaborador_proprio(colaborador_id));

-- GRANT (RLS != GRANT, Postgres exige ambos)
grant select, insert, update, delete
  on public.colaboradores_ferias_periodos to authenticated;

-- ===========================================================================
-- 6. Função fn_gerar_ferias_periodos (trigger de geração automática)
-- ===========================================================================

create or replace function public.fn_gerar_ferias_periodos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inicio date;
  v_fim date;
  v_numero int;
  v_hoje date := current_date;
  v_limite date;
begin
  if new.data_admissao is null then
    return new;
  end if;

  -- Limpa períodos ainda não-utilizados (sem lançamento vinculado) e regenera.
  -- No MVP ainda não existe tabela colaboradores_ferias_lancamentos (vem em S2),
  -- então o NOT EXISTS retorna true para todos; essa cláusula fica resiliente
  -- pra quando S2 chegar.
  delete from public.colaboradores_ferias_periodos p
   where p.colaborador_id = new.id
     and not exists (
       select 1
         from information_schema.tables
        where table_schema = 'public'
          and table_name = 'colaboradores_ferias_lancamentos'
     );

  v_limite := v_hoje + interval '2 years';
  v_numero := 1;
  v_inicio := new.data_admissao;

  while v_inicio <= v_limite loop
    v_fim := v_inicio + interval '1 year' - interval '1 day';

    insert into public.colaboradores_ferias_periodos (
      tenant_id, colaborador_id, numero,
      aquisitivo_inicio, aquisitivo_fim,
      concessivo_inicio, concessivo_fim,
      dias_direito, status
    ) values (
      new.tenant_id, new.id, v_numero,
      v_inicio, v_fim,
      v_fim + 1, v_fim + interval '1 year',
      30,
      case
        when v_hoje <= v_fim then 'incompleto'::public.ferias_periodo_status
        when v_hoje > (v_fim + interval '1 year')::date then 'vencido'::public.ferias_periodo_status
        when ((v_fim + interval '1 year')::date - v_hoje) <= 60 then 'em_alerta'::public.ferias_periodo_status
        else 'apto'::public.ferias_periodo_status
      end
    )
    on conflict (colaborador_id, numero) do nothing;

    v_inicio := v_fim + 1;
    v_numero := v_numero + 1;
  end loop;

  return new;
end;
$function$;

comment on function public.fn_gerar_ferias_periodos is
  'Trigger function: gera períodos aquisitivos+concessivos do colaborador da data_admissao até current_date + 2 anos. Idempotente via ON CONFLICT. Status derivado da data atual.';

-- Trigger: dispara em insert ou update de data_admissao
drop trigger if exists trg_colaboradores_gerar_ferias_periodos on public.colaboradores;
create trigger trg_colaboradores_gerar_ferias_periodos
  after insert or update of data_admissao on public.colaboradores
  for each row execute function public.fn_gerar_ferias_periodos();
