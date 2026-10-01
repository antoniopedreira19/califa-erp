-- Motivo: fila in-app de notificações do subsistema de Férias + função
-- fn_calcular_meses_rescisao que implementa a regra dos avós (F12).
--
-- Referências:
--   - docs/modulos/rh/25-ferias.md §4.7 (regra dos avós) e §6 (notificações)
--   - docs/modulos/rh/26-ferias-modelo-de-dados.md §5, §6.2, §6.3
--   - docs/modulos/rh/27-ferias-plano-de-execucao.md S2

-- ===========================================================================
-- 1. Enum ferias_notificacao_tipo
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ferias_notificacao_tipo') then
    create type public.ferias_notificacao_tipo as enum (
      'concessivo_liberado',
      'concessivo_em_alerta',
      'ferias_vencidas',
      'solicitacao',
      'em_analise',
      'aprovada',
      'reprovada',
      'alteracao',
      'cancelamento',
      'lembrete',
      'inicio',
      'retorno',
      'emitir_nf'
    );
  end if;
end$$;

comment on type public.ferias_notificacao_tipo is
  'Tipos de notificação in-app do subsistema de Férias. Alertas automáticos (concessivo_liberado, em_alerta, vencidas, emitir_nf, retorno) são gerados por job diário. Fluxo (solicitacao, aprovada, reprovada etc.) é gerado por server actions.';

-- ===========================================================================
-- 2. Tabela colaboradores_ferias_notificacoes
-- ===========================================================================

create table if not exists public.colaboradores_ferias_notificacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  tipo public.ferias_notificacao_tipo not null,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  lancamento_id uuid references public.colaboradores_ferias_lancamentos(id) on delete cascade,
  periodo_id uuid references public.colaboradores_ferias_periodos(id) on delete cascade,
  destinatario_user_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  mensagem text not null,
  payload jsonb not null default '{}'::jsonb,
  lida_em timestamptz,
  criada_em timestamptz not null default now()
);

comment on table public.colaboradores_ferias_notificacoes is
  'Fila de notificações in-app do subsistema de férias. Uma linha por destinatário (ex: concessivo liberado gera 3 linhas: colaborador, líder, RH).';

-- Índices
create index if not exists idx_ferias_notif_destinatario
  on public.colaboradores_ferias_notificacoes (destinatario_user_id, lida_em)
  where lida_em is null;

create index if not exists idx_ferias_notif_tenant_tipo
  on public.colaboradores_ferias_notificacoes (tenant_id, tipo);

create index if not exists idx_ferias_notif_colaborador
  on public.colaboradores_ferias_notificacoes (colaborador_id);

-- RLS
alter table public.colaboradores_ferias_notificacoes enable row level security;

drop policy if exists ferias_notif_destinatario_read on public.colaboradores_ferias_notificacoes;
create policy ferias_notif_destinatario_read on public.colaboradores_ferias_notificacoes
  for select to authenticated
  using (destinatario_user_id = (select auth.uid()));

drop policy if exists ferias_notif_destinatario_mark_read on public.colaboradores_ferias_notificacoes;
create policy ferias_notif_destinatario_mark_read on public.colaboradores_ferias_notificacoes
  for update to authenticated
  using (destinatario_user_id = (select auth.uid()))
  with check (destinatario_user_id = (select auth.uid()));

drop policy if exists ferias_notif_rh_admin_all on public.colaboradores_ferias_notificacoes;
create policy ferias_notif_rh_admin_all on public.colaboradores_ferias_notificacoes
  for all to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id))
  with check (public.is_tenant_admin(tenant_id) or public.is_tenant_rh(tenant_id));

-- GRANT
grant select, insert, update, delete
  on public.colaboradores_ferias_notificacoes to authenticated;

-- ===========================================================================
-- 3. Helper fn_criar_notificacao_ferias (reduz boilerplate em server actions)
-- ===========================================================================

create or replace function public.fn_criar_notificacao_ferias(
  p_tenant_id uuid,
  p_tipo public.ferias_notificacao_tipo,
  p_colaborador_id uuid,
  p_destinatarios uuid[],
  p_titulo text,
  p_mensagem text,
  p_payload jsonb default '{}'::jsonb,
  p_lancamento_id uuid default null,
  p_periodo_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.colaboradores_ferias_notificacoes
    (tenant_id, tipo, colaborador_id, lancamento_id, periodo_id,
     destinatario_user_id, titulo, mensagem, payload)
  select p_tenant_id, p_tipo, p_colaborador_id, p_lancamento_id, p_periodo_id,
         unnest(p_destinatarios), p_titulo, p_mensagem, p_payload;
end;
$$;

comment on function public.fn_criar_notificacao_ferias is
  'Helper que cria 1 notificação por destinatário em p_destinatarios[]. Reduz boilerplate em server actions e triggers.';

-- ===========================================================================
-- 4. Função fn_calcular_meses_rescisao — REGRA DOS AVÓS (F12)
-- ===========================================================================

create or replace function public.fn_calcular_meses_rescisao(
  p_colaborador_id uuid,
  p_data_demissao date
)
returns int
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_total_meses int := 0;
  v_periodo public.colaboradores_ferias_periodos%rowtype;
  v_dias_usados int;
  v_dias_pendentes int;
  v_dia_demissao int;
  v_inicio_mes_demissao date;
  v_meses_curso int;
  v_admissao date;
begin
  select data_admissao into v_admissao
    from public.colaboradores where id = p_colaborador_id;
  if not found then
    raise exception 'Colaborador % não encontrado', p_colaborador_id;
  end if;
  if v_admissao is null then
    return 0;
  end if;
  if p_data_demissao < v_admissao then
    raise exception 'Data de demissão % anterior à admissão %', p_data_demissao, v_admissao;
  end if;

  -- 1) Períodos aquisitivos JÁ FECHADOS antes da demissão com saldo pendente.
  for v_periodo in
    select *
      from public.colaboradores_ferias_periodos
     where colaborador_id = p_colaborador_id
       and aquisitivo_fim < p_data_demissao
  loop
    select coalesce(sum(dias), 0) into v_dias_usados
      from public.colaboradores_ferias_lancamentos
     where periodo_id = v_periodo.id
       and status in ('aprovado', 'concluido');

    v_dias_pendentes := greatest(v_periodo.dias_direito - v_dias_usados, 0);
    v_total_meses := v_total_meses + round(v_dias_pendentes::numeric / 30 * 12)::int;
  end loop;

  -- 2) Período aquisitivo EM CURSO: regra dos 15 dias.
  select *
    into v_periodo
    from public.colaboradores_ferias_periodos
   where colaborador_id = p_colaborador_id
     and p_data_demissao between aquisitivo_inicio and aquisitivo_fim
   limit 1;

  if found then
    v_inicio_mes_demissao := date_trunc('month', p_data_demissao)::date;
    v_meses_curso :=
      (extract(year from age(v_inicio_mes_demissao, v_periodo.aquisitivo_inicio))::int) * 12
      + (extract(month from age(v_inicio_mes_demissao, v_periodo.aquisitivo_inicio))::int);

    v_dia_demissao := extract(day from p_data_demissao)::int;
    if v_dia_demissao >= 15 then
      v_meses_curso := v_meses_curso + 1;
    end if;

    v_total_meses := v_total_meses + v_meses_curso;
  end if;

  return v_total_meses;
end;
$$;

comment on function public.fn_calcular_meses_rescisao is
  'Calcula total de avós (meses de direito a férias) para rescisão. Regra dos avós (F12 em docs/modulos/rh/25-ferias.md §4.7): 12 avós por período aquisitivo completo; conta avô no mês de demissão se trabalhou >= 15 dias.';
