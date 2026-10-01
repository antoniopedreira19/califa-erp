-- Motivo: tabela central do subsistema de Férias — lançamentos de uso
-- (usufruto ou abono pecuniário) de cada colaborador. Status pendente →
-- aprovado → concluído.
--
-- Referências:
--   - docs/modulos/rh/25-ferias.md §4.4, §4.5, §5
--   - docs/modulos/rh/26-ferias-modelo-de-dados.md §2 (enums), §4
--   - docs/modulos/rh/27-ferias-plano-de-execucao.md S2
--
-- Decisões incorporadas:
--   - Tipos: usufruto, abono_combinado, abono_avulso, abono_excepcional (F3).
--   - Status: pendente_aprovacao → em_analise → aprovado → concluido (ou
--     reprovado/cancelado).
--   - abono_avulso tem periodo_id = null (não vincula a aquisitivo específico).
--   - Trigger valida saldo apenas em aprovado/concluido vinculado a período.
--   - RLS: 4 policies — RH all, colab read own, colab insert own (como
--     pendente), colab cancel own (pendente ou aprovado-futuro).

-- ===========================================================================
-- 1. Enums
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ferias_lancamento_tipo') then
    create type public.ferias_lancamento_tipo as enum (
      'usufruto',
      'abono_combinado',
      'abono_avulso',
      'abono_excepcional'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'ferias_lancamento_status') then
    create type public.ferias_lancamento_status as enum (
      'pendente_aprovacao',
      'em_analise',
      'aprovado',
      'reprovado',
      'cancelado',
      'concluido'
    );
  end if;
end$$;

comment on type public.ferias_lancamento_tipo is
  'Tipo de lançamento de férias. usufruto=dias de folga; abono_combinado=venda dentro do bloco (CLT clássico); abono_avulso=venda sem gozar (modelo PJ California); abono_excepcional=venda > 10 dias por acordo.';

comment on type public.ferias_lancamento_status is
  'Status do lançamento. Fluxo típico: pendente_aprovacao → em_analise (opcional) → aprovado → concluido. Alternativas: reprovado, cancelado.';

-- ===========================================================================
-- 2. Tabela colaboradores_ferias_lancamentos
-- ===========================================================================

create table if not exists public.colaboradores_ferias_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  periodo_id uuid references public.colaboradores_ferias_periodos(id) on delete restrict,
  tipo public.ferias_lancamento_tipo not null,
  data_inicio date not null,
  data_fim date not null,
  dias int not null check (dias > 0 and dias <= 30),
  status public.ferias_lancamento_status not null default 'pendente_aprovacao',
  solicitado_por uuid not null references public.profiles(id),
  aprovado_por uuid references public.profiles(id),
  aprovado_em timestamptz,
  motivo_reprovacao text,
  observacao text,
  lancado_direto_por_rh boolean not null default false,
  -- Valores calculados (só PJ, preenchidos pelo trigger de aprovação em S7)
  valor_base_remuneracao numeric(14,2),
  valor_ferias numeric(14,2),
  valor_um_terco numeric(14,2),
  valor_abono numeric(14,2),
  valor_total numeric(14,2),
  recibo_url text,
  recibo_gerado_em timestamptz,
  conta_avulsa_id uuid references public.contas_avulsas(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ferias_lancamento_datas
    check (data_fim >= data_inicio and dias = (data_fim - data_inicio + 1)),
  constraint chk_ferias_lancamento_abono_avulso_sem_periodo
    check (
      (tipo = 'abono_avulso' and periodo_id is null)
      or (tipo <> 'abono_avulso' and periodo_id is not null)
    ),
  constraint chk_ferias_lancamento_valores_coerentes
    check (
      valor_total is null
      or valor_total = coalesce(valor_ferias,0) + coalesce(valor_um_terco,0) + coalesce(valor_abono,0)
    )
);

comment on table public.colaboradores_ferias_lancamentos is
  'Lançamento de usufruto de férias ou abono. Status pendente → aprovado → concluído. Valores só são calculados para PJ (CLT recebe recibo da contabilidade).';

comment on column public.colaboradores_ferias_lancamentos.periodo_id is
  'FK pro período aquisitivo. Null apenas quando tipo = abono_avulso (venda de dias fora do bloco de férias — modelo PJ California).';

comment on column public.colaboradores_ferias_lancamentos.lancado_direto_por_rh is
  'True quando RH lança sem passar pelo fluxo de solicitação do colaborador (ex: histórico, excepcionalidade). Rastro de auditoria.';

-- Índices
create index if not exists idx_ferias_lancamentos_colaborador
  on public.colaboradores_ferias_lancamentos (colaborador_id);

create index if not exists idx_ferias_lancamentos_periodo
  on public.colaboradores_ferias_lancamentos (periodo_id);

create index if not exists idx_ferias_lancamentos_tenant_status
  on public.colaboradores_ferias_lancamentos (tenant_id, status);

create index if not exists idx_ferias_lancamentos_data_inicio
  on public.colaboradores_ferias_lancamentos (data_inicio)
  where status = 'aprovado';

-- Trigger updated_at
drop trigger if exists trg_ferias_lancamentos_updated_at on public.colaboradores_ferias_lancamentos;
create trigger trg_ferias_lancamentos_updated_at
  before update on public.colaboradores_ferias_lancamentos
  for each row execute function public.fn_set_updated_at();

-- RLS
alter table public.colaboradores_ferias_lancamentos enable row level security;

drop policy if exists ferias_lancamentos_rh_admin_all on public.colaboradores_ferias_lancamentos;
create policy ferias_lancamentos_rh_admin_all on public.colaboradores_ferias_lancamentos
  for all to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

drop policy if exists ferias_lancamentos_colab_read_own on public.colaboradores_ferias_lancamentos;
create policy ferias_lancamentos_colab_read_own on public.colaboradores_ferias_lancamentos
  for select to authenticated
  using (public.is_colaborador_proprio(colaborador_id));

drop policy if exists ferias_lancamentos_colab_insert_own on public.colaboradores_ferias_lancamentos;
create policy ferias_lancamentos_colab_insert_own on public.colaboradores_ferias_lancamentos
  for insert to authenticated
  with check (
    public.is_colaborador_proprio(colaborador_id)
    and status = 'pendente_aprovacao'
    and lancado_direto_por_rh = false
    and solicitado_por = (select auth.uid())
  );

drop policy if exists ferias_lancamentos_colab_cancel_own on public.colaboradores_ferias_lancamentos;
create policy ferias_lancamentos_colab_cancel_own on public.colaboradores_ferias_lancamentos
  for update to authenticated
  using (
    public.is_colaborador_proprio(colaborador_id)
    and (
      status = 'pendente_aprovacao'
      or (status = 'aprovado' and data_inicio > current_date)
    )
  )
  with check (
    public.is_colaborador_proprio(colaborador_id)
    and status = 'cancelado'
  );

-- GRANT
grant select, insert, update, delete
  on public.colaboradores_ferias_lancamentos to authenticated;

-- ===========================================================================
-- 3. Função fn_recalcular_status_periodo (chamada após mudança em lançamentos)
-- ===========================================================================

create or replace function public.fn_recalcular_status_periodo(p_periodo_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_periodo public.colaboradores_ferias_periodos%rowtype;
  v_dias_usados int;
  v_hoje date := current_date;
begin
  select * into v_periodo
    from public.colaboradores_ferias_periodos
   where id = p_periodo_id;

  if not found then return; end if;

  select coalesce(sum(dias), 0) into v_dias_usados
    from public.colaboradores_ferias_lancamentos
   where periodo_id = p_periodo_id
     and status in ('aprovado', 'concluido');

  update public.colaboradores_ferias_periodos
     set status = case
       when v_hoje <= v_periodo.aquisitivo_fim then 'incompleto'::public.ferias_periodo_status
       when v_dias_usados >= v_periodo.dias_direito then 'regularizado'::public.ferias_periodo_status
       when v_hoje > v_periodo.concessivo_fim then 'vencido'::public.ferias_periodo_status
       when (v_periodo.concessivo_fim - v_hoje) <= 60 then 'em_alerta'::public.ferias_periodo_status
       else 'apto'::public.ferias_periodo_status
     end
   where id = p_periodo_id;
end;
$$;

comment on function public.fn_recalcular_status_periodo is
  'Reavalia status do período aquisitivo com base nos lançamentos aprovados/concluídos e na data atual. Chamada manualmente ou por trigger após mudança em lançamentos.';

-- ===========================================================================
-- 4. Função fn_valida_saldo_periodo (trigger de validação)
-- ===========================================================================

create or replace function public.fn_valida_saldo_periodo()
returns trigger
language plpgsql
as $$
declare
  v_dias_direito int;
  v_dias_usados int;
begin
  -- Só valida pra lançamentos vinculados a período (não abono_avulso)
  if new.periodo_id is null then
    return new;
  end if;

  -- Só valida quando status é aprovado ou concluido
  if new.status not in ('aprovado', 'concluido') then
    return new;
  end if;

  select dias_direito into v_dias_direito
    from public.colaboradores_ferias_periodos
   where id = new.periodo_id;

  if not found then
    raise exception 'Período aquisitivo % não encontrado', new.periodo_id;
  end if;

  select coalesce(sum(dias), 0) into v_dias_usados
    from public.colaboradores_ferias_lancamentos
   where periodo_id = new.periodo_id
     and status in ('aprovado', 'concluido')
     and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_dias_usados + new.dias > v_dias_direito then
    raise exception
      'Saldo insuficiente no período aquisitivo: % dias já usados + % novos > % de direito',
      v_dias_usados, new.dias, v_dias_direito;
  end if;

  return new;
end;
$$;

comment on function public.fn_valida_saldo_periodo is
  'Impede aprovar lançamento que estoure o saldo do período aquisitivo (soma de dias aprovados/concluídos nunca pode passar de dias_direito).';

drop trigger if exists trg_ferias_lancamentos_valida_saldo on public.colaboradores_ferias_lancamentos;
create trigger trg_ferias_lancamentos_valida_saldo
  before insert or update of status, dias, periodo_id on public.colaboradores_ferias_lancamentos
  for each row execute function public.fn_valida_saldo_periodo();

-- ===========================================================================
-- 5. Trigger de recálculo de status do período após mudança em lançamento
-- ===========================================================================

create or replace function public.fn_trg_lancamento_recalc_periodo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    if old.periodo_id is not null then
      perform public.fn_recalcular_status_periodo(old.periodo_id);
    end if;
    return old;
  end if;

  if new.periodo_id is not null then
    perform public.fn_recalcular_status_periodo(new.periodo_id);
  end if;

  if tg_op = 'UPDATE' and old.periodo_id is distinct from new.periodo_id and old.periodo_id is not null then
    perform public.fn_recalcular_status_periodo(old.periodo_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ferias_lancamentos_recalc_periodo on public.colaboradores_ferias_lancamentos;
create trigger trg_ferias_lancamentos_recalc_periodo
  after insert or update of status, dias, periodo_id or delete on public.colaboradores_ferias_lancamentos
  for each row execute function public.fn_trg_lancamento_recalc_periodo();
