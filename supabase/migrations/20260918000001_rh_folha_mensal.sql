-- =====================================================================
-- RH — Subsistema Folha Mensal: transforma o esqueleto em motor operacional
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O MVP do módulo RH (2026-09-16) deixou `folhas_pagamento` e
-- `folhas_pagamento_alocacoes` como esqueleto — RLS + GRANTs mas
-- estruturalmente mínimas, sem estados nem rastro. Nenhuma linha foi
-- inserida (confirmado por MCP em 2026-09-18: `SELECT COUNT(*) = 0`).
--
-- Esta migration expande o esqueleto para o subsistema "Folha mensal":
--
--   1. Enum `folha_linha_status` (rascunho, enviada, aprovada,
--      pendente_correcao, paga) — cada LINHA da folha tem seu próprio
--      estado, não a folha inteira.
--   2. Colunas de rastro em `folhas_pagamento`: motivo_pendencia,
--      enviada_em/por, aprovada_em/por, paga_em/por, data_pagamento.
--   3. Constraint trigger `trg_folha_alocacao_soma_100` — deferrable
--      initially deferred, mesmo padrão de colaboradores_alocacoes.
--   4. Helper `is_tenant_financeiro(uuid)` no padrão de is_tenant_rh.
--   5. Policies RLS atualizadas — SELECT liberado para admin OR rh OR
--      financeiro; INSERT/UPDATE também (a regra "quem escreve em qual
--      status" é enforçada pelas server actions, não pela RLS).
--
-- Ver docs/modulos/rh/20-folha-mensal.md — spec completa.
--
-- Dependências:
--   • public.folhas_pagamento (esqueleto — Fase 7 do MVP)
--   • public.folhas_pagamento_alocacoes (esqueleto — Fase 7 do MVP)
--   • public.is_tenant_admin(uuid), public.is_tenant_rh(uuid)
--   • public.set_updated_at()
--   • enum public.app_role com valor 'financeiro' (Task 001)
--
-- Aditivo do começo ao fim. O ALTER TYPE do status é seguro porque
-- 0 linhas existiam antes desta migration — nenhum dado é reescrito.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Helper is_tenant_financeiro(uuid)
-- ---------------------------------------------------------------------
--
-- Espelho fiel de is_tenant_admin/is_tenant_rh, só troca o filtro de
-- role. Financeiro precisa entrar nas policies do RH a partir da Folha.

create or replace function public.is_tenant_financeiro(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.user_id = (select auth.uid())
      and tm.tenant_id = p_tenant_id
      and tm.status = 'ativo'
      and tm.role = 'financeiro'
      and p.ativo = true
  );
$$;

revoke all on function public.is_tenant_financeiro(uuid) from public, anon;
grant  execute on function public.is_tenant_financeiro(uuid) to authenticated;

comment on function public.is_tenant_financeiro(uuid) is
  'True se o usuario autenticado for membro ativo com role financeiro no tenant. Padrao espelhado de is_tenant_admin(uuid).';


-- ---------------------------------------------------------------------
-- 2. Enum folha_linha_status
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'folha_linha_status') then
    create type public.folha_linha_status as enum (
      'rascunho',
      'enviada',
      'aprovada',
      'pendente_correcao',
      'paga'
    );
  end if;
end$$;


-- ---------------------------------------------------------------------
-- 3. folhas_pagamento: converte status para enum + colunas de rastro
-- ---------------------------------------------------------------------
--
-- 3.1 — status: text → folha_linha_status.
-- O default text 'rascunho' bloqueia o ALTER TYPE porque coerciona
-- default. Solução: drop default → altera tipo → recria default como
-- enum. Como a tabela tinha 0 linhas, nenhum backfill é necessário.

alter table public.folhas_pagamento
  alter column status drop default;

alter table public.folhas_pagamento
  alter column status type public.folha_linha_status
  using status::public.folha_linha_status;

alter table public.folhas_pagamento
  alter column status set default 'rascunho'::public.folha_linha_status;

-- 3.2 — Colunas de rastro
alter table public.folhas_pagamento
  add column if not exists motivo_pendencia    text,
  add column if not exists enviada_em          timestamptz,
  add column if not exists enviada_por         uuid references public.profiles(id),
  add column if not exists aprovada_em         timestamptz,
  add column if not exists aprovada_por        uuid references public.profiles(id),
  add column if not exists reprovada_em        timestamptz,
  add column if not exists reprovada_por       uuid references public.profiles(id),
  add column if not exists data_pagamento      date,
  add column if not exists paga_em             timestamptz,
  add column if not exists paga_por            uuid references public.profiles(id);

-- 3.3 — Coerência de estado × rastro (defesa em profundidade)
alter table public.folhas_pagamento
  add constraint chk_folhas_pendencia_coerente check (
    (status = 'pendente_correcao' and motivo_pendencia is not null and length(trim(motivo_pendencia)) >= 3)
    or (status <> 'pendente_correcao')
  );

comment on column public.folhas_pagamento.status is
  'rascunho: RH pode editar. enviada: financeiro pode editar/aprovar/reprovar. pendente_correcao: RH corrige e reenvia. aprovada: linha imutavel, aguardando pagamento. paga: terminal.';

comment on column public.folhas_pagamento.salario_base is
  'Valor MANUAL que sera pago. Nao e vigente da Camada 1 — e o valor definido pelo RH e possivelmente ajustado pelo financeiro. Ao aprovar com valor diferente da Camada 1, o sistema propaga a mudanca para colaboradores_salarios.';

comment on column public.folhas_pagamento.data_pagamento is
  'Data em que o financeiro planeja pagar. Nasce na aprovacao; pode ser repactuada. Diferente de paga_em (data em que efetivamente pagou).';

comment on column public.folhas_pagamento.motivo_pendencia is
  'Motivo preenchido pelo financeiro ao reprovar a linha. Visivel pro RH corrigir. Ao reenviar a linha, este campo e limpo; o motivo permanece no audit.';

-- 3.4 — Índices por status (filtros comuns na UI)
create index if not exists idx_folhas_status_competencia
  on public.folhas_pagamento (tenant_id, competencia_ano, competencia_mes, status);

create index if not exists idx_folhas_pendencia
  on public.folhas_pagamento (tenant_id)
  where status = 'pendente_correcao';


-- ---------------------------------------------------------------------
-- 4. folhas_pagamento_alocacoes: constraint trigger de soma=100
-- ---------------------------------------------------------------------
--
-- Mesmo padrão de colaboradores_alocacoes: sum > 0 → precisa ser 100
-- (tolerância 0.01). Constraint trigger DEFERRABLE INITIALLY DEFERRED
-- valida no COMMIT — permite swap atômico durante geração/edição.

create or replace function public.enforce_folha_alocacao_soma_100()
returns trigger
language plpgsql
as $$
declare
  v_folha_id uuid;
  v_soma     numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_folha_id := old.folha_id;
  else
    v_folha_id := new.folha_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.folhas_pagamento_alocacoes
   where folha_id = v_folha_id;

  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'Rateio de alocacoes da folha % soma %, deve ser 100.00.',
      v_folha_id, v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

comment on function public.enforce_folha_alocacao_soma_100() is
  'Verifica que a soma dos percentuais de folhas_pagamento_alocacoes de uma linha de folha = 100.00 ou 0. Constraint trigger deferred — dispara no COMMIT.';

drop trigger if exists trg_folha_alocacao_soma_100 on public.folhas_pagamento_alocacoes;
create constraint trigger trg_folha_alocacao_soma_100
  after insert or update or delete
  on public.folhas_pagamento_alocacoes
  deferrable initially deferred
  for each row
  execute function public.enforce_folha_alocacao_soma_100();


-- ---------------------------------------------------------------------
-- 5. RLS policies (SELECT/INSERT/UPDATE liberado para admin OR rh OR financeiro)
-- ---------------------------------------------------------------------
--
-- Substitui as policies do esqueleto (que só tinham admin OR rh). A
-- regra "quem pode editar em qual status" é enforçada pelas server
-- actions (o gate é dinâmico e depende de status; não cabe em WITH
-- CHECK).
--
-- DELETE fica de fora no MVP (folha aprovada/paga é imutável;
-- rascunhos deletados exigem regra futura).

drop policy if exists folhas_select on public.folhas_pagamento;
create policy folhas_select on public.folhas_pagamento
  for select to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

drop policy if exists folhas_insert on public.folhas_pagamento;
create policy folhas_insert on public.folhas_pagamento
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

drop policy if exists folhas_update on public.folhas_pagamento;
create policy folhas_update on public.folhas_pagamento
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

drop policy if exists folha_aloc_select on public.folhas_pagamento_alocacoes;
create policy folha_aloc_select on public.folhas_pagamento_alocacoes
  for select to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

drop policy if exists folha_aloc_insert on public.folhas_pagamento_alocacoes;
create policy folha_aloc_insert on public.folhas_pagamento_alocacoes
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

drop policy if exists folha_aloc_update on public.folhas_pagamento_alocacoes;
create policy folha_aloc_update on public.folhas_pagamento_alocacoes
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

-- DELETE liberado em folhas_pagamento_alocacoes: necessário no swap
-- (RH edita linhas de alocação de uma folha em rascunho — pode remover
-- linha). Gate role continua o mesmo.

drop policy if exists folha_aloc_delete on public.folhas_pagamento_alocacoes;
create policy folha_aloc_delete on public.folhas_pagamento_alocacoes
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_tenant_financeiro(tenant_id)
  );

grant delete on public.folhas_pagamento_alocacoes to authenticated;
