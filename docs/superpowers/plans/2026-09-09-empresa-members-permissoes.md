# Fase 2B — Permissão por empresa e regional (empresa_members) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir permissão explícita de acesso por empresa (e opcionalmente por regional) para cada usuário do tenant, com bypass automático pra admin, backfill amplo pra manter compat, e integração com convite via metadata.

**Architecture:** Uma tabela nova `empresa_members(user_id, empresa_id, regional_id nullable)` — NULL em regional_id = acesso amplo. Função canônica `can_access_empresa_regional()` é a fonte-verdade — reusada em RLS de 13 tabelas e no code. Session context materializa `empresasVisiveis` + `regionaisVisiveisPorEmpresa` (cache 5min via `unstable_cache`). Backfill dá acesso amplo a todo user existente (dia 1 idêntico ao de hoje). Trigger `handle_new_user` estendido lê metadata do convite e aplica permissões na aceitação.

**Tech Stack:** PostgreSQL 15+ (Supabase), Supabase Auth (`inviteUserByEmail` + `user_metadata`), Supabase MCP (`apply_migration`, `execute_sql`), Next.js App Router, React, TypeScript, `unstable_cache` do Next.

**Spec:** [docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md](../specs/2026-09-09-empresa-members-permissoes-design.md)

## Global Constraints

- Toda alteração de banco segue `docs/FLUXO-BANCO.md`: ler → migration → apply_migration → conferir → commit.
- Migration destrutiva exige confirmação; toda esta fase é **aditiva** (novas tabelas, funções, colunas de metadata). RLS existente é **ampliada** pra também respeitar `empresa_members` — regressão zero por causa do backfill.
- Toda tabela nasce com RLS + GRANT para `authenticated` + índice em FKs importantes.
- CCH está ativa desde 2026-09-08 (id `1703fd52-a36c-4701-816c-a0bcc868351d`).
- Tenant único ativo: Agência California, id `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c`.
- Empresas ativas: 4 (Agência California, CCH LTDA, Empresa Teste, Hitlab).
- Roles de tenant_members: `administrador`, `gerente_producao`, `financeiro`, `produtor`, `freelancer` (enum `app_role`).
- Admin do tenant **bypassa** todas as checagens de `empresa_members`. Nunca precisa de linha.
- Backfill inicial dá `regional_id=NULL` (acesso amplo) para todo user viewer/operator existente em todas as empresas ativas do tenant.
- Cache de permissões: `unstable_cache` TTL 300s, tag `user-permissions:{userId}`.
- Auditoria: cada mudança em `empresa_members` grava `audit_events` (acao: `empresa_member.criado`, `.atualizado`, `.removido`, `.status_alterado`).
- `lib/types.ts` é escrito à mão — atualizar tipos junto no mesmo commit.
- Strings visíveis em pt-BR com acento; identificadores em código sem acento (convenção).
- Nome de migration: `AAAAMMDD00000N_descricao_curta.sql`, prefixo único.

---

### Task 1: Migration — `empresa_members` + integridade + funções

**Files:**
- Create: `supabase/migrations/20260909000001_empresa_members.sql`

**Interfaces:**
- Consumes: `empresas`, `regionais`, `tenants`, `auth.users`, enum `tenant_member_status` (todos já existem).
- Produces:
  - Tabela `public.empresa_members(id, tenant_id, user_id, empresa_id, regional_id nullable, status, created_by, created_at, updated_at)`
  - Funções PL/pgSQL: `ck_empresa_members_regional_bate_empresa()`, `ck_empresa_members_amplo_xor_restrito()`
  - Triggers: `tr_empresa_members_regional_bate`, `tr_empresa_members_amplo_xor_restrito`
  - Funções SQL: `empresas_visiveis_do_user(uuid)`, `regionais_visiveis_do_user(uuid)`, `can_access_empresa_regional(uuid, uuid, uuid)`
  - Índices: `idx_empresa_members_user_empresa`, `idx_empresa_members_user_status` (partial), `idx_empresa_members_empresa_status` (partial)

- [ ] **Step 1: Descobrir próximo prefixo livre**

Via MCP:
```
mcp__supabase__list_migrations
```
Expected: última migration é ~2026-09-08. Próximo prefixo `20260909000001` (ajustar se conflito).

- [ ] **Step 2: Escrever arquivo de migration**

Criar `supabase/migrations/20260909000001_empresa_members.sql` com racional comentado e conteúdo exato:

```sql
-- Motivo: Fase 2B — permissao explicita por empresa (e opcionalmente por
-- regional) para cada usuario do tenant. Ate agora, todo membro do
-- tenant enxergava todas as empresas do grupo. Esta migration cria a
-- tabela empresa_members, funcoes helpers reusaveis em RLS e code, e
-- triggers de integridade.
--
-- Aditivo: nenhuma tabela existente e modificada. RLS nas 13 tabelas
-- vem em migration separada (20260909000003) apos backfill.
--
-- Ver docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md

begin;

-- Tabela --------------------------------------------------------------
create table public.empresa_members (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  regional_id  uuid null references public.regionais(id) on delete cascade,
  status       public.tenant_member_status not null default 'ativo',
  created_by   uuid null references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_empresa_members
    unique nulls not distinct (user_id, empresa_id, regional_id)
);

comment on table  public.empresa_members is
  'Permissao de acesso de um usuario a uma empresa do tenant. regional_id NULL = acesso amplo a todas as regionais dessa empresa; quando preenchido, restringe as regionais listadas nas linhas.';
comment on column public.empresa_members.regional_id is
  'NULL = acesso amplo. Multiplas linhas com regional_id preenchido = restrito a essas regionais.';

alter table public.empresa_members enable row level security;

-- Grants
grant select, insert, update, delete on public.empresa_members to authenticated;
revoke all on public.empresa_members from anon;

-- updated_at automatico (funcao ja existe no projeto)
create trigger tr_empresa_members_updated_at
  before update on public.empresa_members
  for each row execute function public.set_updated_at();

-- Integridade: regional pertence a empresa da linha -------------------
create or replace function public.ck_empresa_members_regional_bate_empresa()
returns trigger language plpgsql
set search_path = public
as $$
declare v_empresa uuid;
begin
  if new.regional_id is null then return new; end if;
  select empresa_id into v_empresa from public.regionais where id = new.regional_id;
  if v_empresa is null then
    raise exception 'regional_id % nao existe', new.regional_id;
  end if;
  if v_empresa <> new.empresa_id then
    raise exception 'regional_id % pertence a empresa %, nao a % (empresa_id da linha)',
      new.regional_id, v_empresa, new.empresa_id;
  end if;
  return new;
end $$;

create trigger tr_empresa_members_regional_bate
  before insert or update of empresa_id, regional_id on public.empresa_members
  for each row execute function public.ck_empresa_members_regional_bate_empresa();

-- Integridade: por (user, empresa) OU tem linha regional=NULL (amplo)
-- OU tem N linhas com regional preenchida (restrito). Nunca as duas.
create or replace function public.ck_empresa_members_amplo_xor_restrito()
returns trigger language plpgsql
set search_path = public
as $$
declare v_amplo int; v_restrito int;
begin
  select
    count(*) filter (where regional_id is null),
    count(*) filter (where regional_id is not null)
  into v_amplo, v_restrito
  from public.empresa_members
  where user_id = new.user_id and empresa_id = new.empresa_id;

  if v_amplo > 0 and v_restrito > 0 then
    raise exception 'user % empresa %: nao pode ter acesso amplo (regional NULL) e restrito ao mesmo tempo',
      new.user_id, new.empresa_id;
  end if;
  return new;
end $$;

create trigger tr_empresa_members_amplo_xor_restrito
  after insert or update on public.empresa_members
  for each row execute function public.ck_empresa_members_amplo_xor_restrito();

-- Indices -------------------------------------------------------------
create index idx_empresa_members_user_empresa
  on public.empresa_members(user_id, empresa_id);
create index idx_empresa_members_user_status
  on public.empresa_members(user_id) where status = 'ativo';
create index idx_empresa_members_empresa_status
  on public.empresa_members(empresa_id) where status = 'ativo';

-- Funcao canonica — usada em RLS e code ------------------------------
create or replace function public.can_access_empresa_regional(
  p_user_id     uuid,
  p_empresa_id  uuid,
  p_regional_id uuid
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    -- Bypass: admin do tenant a que essa empresa pertence
    exists(
      select 1
      from public.tenant_members tm
      join public.empresas e on e.tenant_id = tm.tenant_id
      where tm.user_id = p_user_id
        and tm.role = 'administrador'
        and tm.status = 'ativo'
        and e.id = p_empresa_id
    )
    or
    -- Membership: user tem linha ativa na empresa E:
    -- (a) tabela sem regional (p_regional_id NULL) → basta acesso a empresa
    -- (b) user tem acesso amplo (regional_id NULL na membership) OU
    -- (c) user tem linha com regional_id igual a essa
    exists(
      select 1 from public.empresa_members em
      where em.user_id = p_user_id
        and em.empresa_id = p_empresa_id
        and em.status = 'ativo'
        and (
          p_regional_id is null
          or em.regional_id is null
          or em.regional_id = p_regional_id
        )
    );
$$;

comment on function public.can_access_empresa_regional is
  'Fonte-verdade da checagem. Admin do tenant bypassa. Para tabelas sem regional, passe p_regional_id=NULL (short-circuit apos empresa).';

-- Revoga do anon, permite pra authenticated
revoke all on function public.can_access_empresa_regional(uuid, uuid, uuid) from anon, public;
grant execute on function public.can_access_empresa_regional(uuid, uuid, uuid) to authenticated;

-- Helper: empresas visiveis pelo user autenticado ---------------------
-- (setof uuid, usado como .in() em queries que preferem lista)
create or replace function public.empresas_visiveis_do_user(p_user_id uuid)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select e.id from public.empresas e
  join public.tenant_members tm on tm.tenant_id = e.tenant_id
  where tm.user_id = p_user_id
    and tm.role = 'administrador'
    and tm.status = 'ativo'
    and e.ativo = true
  union
  select distinct em.empresa_id from public.empresa_members em
  where em.user_id = p_user_id and em.status = 'ativo';
$$;

revoke all on function public.empresas_visiveis_do_user(uuid) from anon, public;
grant execute on function public.empresas_visiveis_do_user(uuid) to authenticated;

-- Helper: pares (empresa, regional) visiveis
create or replace function public.regionais_visiveis_do_user(p_user_id uuid)
returns table(empresa_id uuid, regional_id uuid)
language sql stable security definer
set search_path = public
as $$
  -- Admin: todas as empresas x todas as regionais delas
  select e.id, r.id
  from public.empresas e
  join public.tenant_members tm on tm.tenant_id = e.tenant_id
  left join public.regionais r on r.empresa_id = e.id and r.ativo = true
  where tm.user_id = p_user_id
    and tm.role = 'administrador'
    and tm.status = 'ativo'
    and e.ativo = true
  union
  -- Membership amplo: (empresa, cada regional dela)
  select em.empresa_id, r.id
  from public.empresa_members em
  left join public.regionais r on r.empresa_id = em.empresa_id and r.ativo = true
  where em.user_id = p_user_id
    and em.status = 'ativo'
    and em.regional_id is null
  union
  -- Membership restrito: pares exatos
  select em.empresa_id, em.regional_id
  from public.empresa_members em
  where em.user_id = p_user_id
    and em.status = 'ativo'
    and em.regional_id is not null;
$$;

revoke all on function public.regionais_visiveis_do_user(uuid) from anon, public;
grant execute on function public.regionais_visiveis_do_user(uuid) to authenticated;

-- RLS: policy da propria tabela ---------------------------------------
-- Membros veem apenas suas proprias linhas; admin do tenant ve todas
-- do tenant. Admin gerencia (insert/update/delete).
create policy empresa_members_select_owner
  on public.empresa_members for select to authenticated
  using (
    user_id = auth.uid()
    or is_tenant_admin(tenant_id)
  );

create policy empresa_members_admin_insert
  on public.empresa_members for insert to authenticated
  with check (is_tenant_admin(tenant_id));

create policy empresa_members_admin_update
  on public.empresa_members for update to authenticated
  using (is_tenant_admin(tenant_id))
  with check (is_tenant_admin(tenant_id));

create policy empresa_members_admin_delete
  on public.empresa_members for delete to authenticated
  using (is_tenant_admin(tenant_id));

commit;
```

- [ ] **Step 3: Aplicar via MCP**

```
mcp__supabase-write__apply_migration
  name: empresa_members
  query: <o conteúdo do arquivo — sem BEGIN/COMMIT (o MCP embrulha)>
```

Expected: `success: true`.

- [ ] **Step 4: Conferir pós-aplicação**

Via MCP `execute_sql`:

```sql
-- Tabela existe, RLS ligada
select relname, relrowsecurity from pg_class where relname='empresa_members';
-- Expected: 1 linha, relrowsecurity=true

-- Triggers criados
select tgname from pg_trigger where tgname like 'tr_empresa_members%' order by tgname;
-- Expected: tr_empresa_members_amplo_xor_restrito, tr_empresa_members_regional_bate, tr_empresa_members_updated_at

-- Funcoes criadas
select proname from pg_proc where proname in (
  'can_access_empresa_regional',
  'empresas_visiveis_do_user',
  'regionais_visiveis_do_user',
  'ck_empresa_members_regional_bate_empresa',
  'ck_empresa_members_amplo_xor_restrito'
) order by proname;
-- Expected: 5 linhas

-- Indices
select indexname from pg_indexes where tablename='empresa_members' order by indexname;
-- Expected: idx_empresa_members_empresa_status, idx_empresa_members_user_empresa, idx_empresa_members_user_status, uq_empresa_members, empresa_members_pkey
```

- [ ] **Step 5: Testar trigger de integridade (regional bate empresa)**

```sql
-- Inserção com regional que NÃO pertence à empresa deve FALHAR
do $$
declare v_agencia uuid; v_regional_hitlab uuid; v_user uuid;
begin
  select id into v_agencia from public.empresas where nome_fantasia='Agência California';
  select r.id into v_regional_hitlab
    from public.regionais r join public.empresas e on e.id=r.empresa_id
    where e.nome_fantasia='Hitlab' limit 1;
  select id into v_user from auth.users limit 1;

  begin
    insert into public.empresa_members(tenant_id, user_id, empresa_id, regional_id)
    values ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', v_user, v_agencia, v_regional_hitlab);
    raise exception 'FALHA: trigger deveria ter bloqueado';
  exception when others then
    raise notice 'OK: %', SQLERRM;
  end;
end $$;
```

Expected: mensagem `OK: regional_id ... pertence a empresa ..., nao a ...`.

- [ ] **Step 6: NÃO commitar ainda**

Commit vai no fim, junto do backfill (task 2) + tipos.

---

### Task 2: Migration — Backfill de compat

**Files:**
- Create: `supabase/migrations/20260909000002_empresa_members_backfill.sql`

**Interfaces:**
- Consumes: `empresa_members` (Task 1), `tenant_members`, `empresas`.
- Produces: linhas em `empresa_members` para todo user viewer/operator existente com acesso amplo a todas as empresas ativas do tenant.

- [ ] **Step 1: Contagem esperada antes de aplicar**

```sql
-- Quantas linhas serao criadas?
select
  count(*) as total_esperado
from public.tenant_members tm
join public.empresas e on e.tenant_id = tm.tenant_id and e.ativo = true
where tm.status = 'ativo'
  and tm.role in ('financeiro', 'produtor', 'freelancer', 'gerente_producao');
```

Expected: ~(qty users não-admin) × 4 empresas ativas. Anotar valor.

- [ ] **Step 2: Escrever migration**

Criar `supabase/migrations/20260909000002_empresa_members_backfill.sql`:

```sql
-- Motivo: manter comportamento identico no dia 1 apos criar
-- empresa_members. Todo user existente (menos admin, que sempre bypassa)
-- ganha acesso amplo a todas as empresas ativas do tenant. Admin
-- restringe depois, gradualmente, sem quebrar ninguem.
--
-- Aditivo, idempotente (on conflict do nothing).
--
-- Ver docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md

begin;

insert into public.empresa_members (
  tenant_id, user_id, empresa_id, regional_id, status, created_by
)
select
  tm.tenant_id,
  tm.user_id,
  e.id,
  null,
  'ativo',
  null
from public.tenant_members tm
join public.empresas e on e.tenant_id = tm.tenant_id and e.ativo = true
where tm.status = 'ativo'
  and tm.role in ('financeiro', 'produtor', 'freelancer', 'gerente_producao')
on conflict on constraint uq_empresa_members do nothing;

commit;
```

- [ ] **Step 3: Aplicar via MCP**

```
mcp__supabase-write__apply_migration
  name: empresa_members_backfill
  query: <SQL sem BEGIN/COMMIT>
```

- [ ] **Step 4: Conferir contagem real**

```sql
select
  count(*) as total_criado,
  count(*) filter (where regional_id is null) as amplos,
  count(distinct user_id) as users_com_acesso,
  count(distinct empresa_id) as empresas_cobertas
from public.empresa_members;
```

Expected: `total_criado` = valor do Step 1, `amplos` = mesmo total, `users_com_acesso` = qty non-admin ativos, `empresas_cobertas` = 4.

- [ ] **Step 5: Testar função `can_access` com um user real não-admin**

```sql
do $$
declare v_user uuid; v_agencia uuid; v_regional_ne uuid; v_pode boolean;
begin
  select tm.user_id into v_user
    from public.tenant_members tm
    where tm.role = 'gerente_producao' and tm.status='ativo'
    limit 1;
  select id into v_agencia from public.empresas where nome_fantasia='Agência California';
  select r.id into v_regional_ne from public.regionais r
    join public.empresas e on e.id=r.empresa_id
    where e.nome_fantasia='Agência California' and r.nome='NE' limit 1;

  select public.can_access_empresa_regional(v_user, v_agencia, v_regional_ne) into v_pode;
  raise notice 'user=% empresa=Agencia regional=NE pode=%', v_user, v_pode;
  if not v_pode then raise exception 'FALHA: gerente_producao com acesso amplo deveria ver NE'; end if;
end $$;
```

Expected: `NOTICE: ... pode=t`, sem exceção.

- [ ] **Step 6: NÃO commitar ainda** — junto com Task 3.

---

### Task 3: Migration — RLS ampliada nas 13 tabelas

**Files:**
- Create: `supabase/migrations/20260909000003_empresa_members_rls.sql`

**Interfaces:**
- Consumes: `can_access_empresa_regional` (Task 1), `is_tenant_admin` (existe).
- Produces: policies `SELECT/INSERT/UPDATE/DELETE` de cada tabela com `empresa_id` passam a filtrar por `can_access_empresa_regional`.

**Nota crítica:** cada tabela pode ter policies existentes com nomes diferentes. **Antes de dropar**, listar policies via `pg_policies`.

- [ ] **Step 1: Listar policies atuais das 13 tabelas**

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname='public'
  and tablename in (
    'jobs','orcamentos','projetos','contas_avulsas','contas_avulsas_recorrentes',
    'lancamentos_financeiros','titulos_receber','desembolsos','pedidos_compra',
    'faturamentos','pp_verba_devolucoes','contas_bancarias','cartoes_credito'
  )
order by tablename, cmd, policyname;
```

Anotar os nomes exatos das policies existentes por tabela — vão ser usados no `drop policy if exists` da migration.

- [ ] **Step 2: Escrever migration**

Criar `supabase/migrations/20260909000003_empresa_members_rls.sql`.

Estrutura por tabela:
1. `drop policy if exists <nome_atual> on <tabela>;` (para cada policy existente listada no Step 1)
2. `create policy <nova_policy> ...` usando `can_access_empresa_regional`.

**Padrão de RLS pra tabelas SEM `regional_id`** (`contas_bancarias`, `cartoes_credito`, `faturamentos`, `pp_verba_devolucoes`, `pedidos_compra`, `contas_avulsas_recorrentes`):

```sql
create policy select_via_empresa_members
  on public.<tabela> for select to authenticated
  using (can_access_empresa_regional(auth.uid(), empresa_id, null));

create policy modify_via_empresa_members
  on public.<tabela> for all to authenticated
  using (can_access_empresa_regional(auth.uid(), empresa_id, null))
  with check (can_access_empresa_regional(auth.uid(), empresa_id, null));
```

**Padrão de RLS pra tabelas COM `regional_id`** (`contas_avulsas`, `lancamentos_financeiros`, `titulos_receber`, `desembolsos`):

```sql
create policy select_via_empresa_members
  on public.<tabela> for select to authenticated
  using (can_access_empresa_regional(auth.uid(), empresa_id, regional_id));

create policy modify_via_empresa_members
  on public.<tabela> for all to authenticated
  using (can_access_empresa_regional(auth.uid(), empresa_id, regional_id))
  with check (can_access_empresa_regional(auth.uid(), empresa_id, regional_id));
```

**Padrão especial — `jobs`, `orcamentos`, `projetos`** (tem regra de freelancer/produtor por projeto):

```sql
create policy select_via_empresa_members
  on public.jobs for select to authenticated
  using (
    can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  );
-- INSERT/UPDATE/DELETE: manter policies existentes ou ampliar igual acima
```

Toda tabela tem também SELECT nativa por tenant_id — que continua servindo pra defesa em profundidade; **não remover**. A nova policy de empresa é `OR`-igada implicitamente com as existentes? **NÃO**: PostgreSQL faz `AND` entre policies SELECT do mesmo role — múltiplas policies têm efeito **restritivo** ✱. Solução: **substituir** a policy existente por uma consolidada.

_✱ Correção precisa: no PG 16+ policies são combinadas por OR pra `PERMISSIVE` (padrão) ou AND pra `RESTRICTIVE`. Mas **incluir** tenant_id na nova policy garante que também respeita o tenant. Padrão consolidado:_

```sql
using (
  tenant_id in (select current_tenant_ids())
  and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
)
```

Fazer **essa** forma consolidada em cada tabela. Um `drop policy if exists` + `create policy` novo consolidado.

**Migration completa (esqueleto):**

```sql
-- Motivo: Fase 2B — RLS das 13 tabelas com empresa_id passa a
-- respeitar empresa_members. Admin bypassa (dentro de
-- can_access_empresa_regional). tenant_id continua no predicado.
-- Backfill (20260909000002) garante que ninguem perde acesso no dia 1.

begin;

-- Cada tabela: drop policies antigas, cria consolidada.
-- Repete o bloco abaixo para cada uma das 13, usando o nome de policy
-- atual anotado no Step 1.

do $$
declare
  t text;
  policy_names_por_tabela text[];
begin
  -- Este bloco DO e apenas ilustrativo do padrao; na migration real,
  -- cada tabela tem seu proprio bloco explicito.
  null;
end $$;

-- Tabela: pedidos_compra (sem regional_id) ----------------------------
drop policy if exists <NOME_ATUAL_1> on public.pedidos_compra;
drop policy if exists <NOME_ATUAL_2> on public.pedidos_compra;
-- ... (para cada policy existente)

create policy select_pedidos_compra_por_empresa
  on public.pedidos_compra for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

create policy modify_pedidos_compra_por_empresa
  on public.pedidos_compra for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- (repetir para: contas_avulsas_recorrentes, contas_bancarias,
--   cartoes_credito, faturamentos, pp_verba_devolucoes — todas sem regional_id)

-- Tabela: contas_avulsas (com regional_id) ---------------------------
drop policy if exists <NOME_ATUAL_1> on public.contas_avulsas;
create policy select_contas_avulsas_por_empresa
  on public.contas_avulsas for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );
create policy modify_contas_avulsas_por_empresa
  on public.contas_avulsas for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );

-- (repetir para: lancamentos_financeiros, titulos_receber, desembolsos)

-- Tabelas: jobs, orcamentos, projetos (freelancer/produtor AND) -----
-- Manter regra de freelancer/produtor por projeto:
drop policy if exists <NOME_ATUAL_1> on public.jobs;
create policy select_jobs_por_empresa
  on public.jobs for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  );
create policy modify_jobs_por_empresa
  on public.jobs for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );

-- (repetir mesmo padrao para: orcamentos, projetos)

commit;
```

**Nota:** o arquivo real deve ter os `drop policy if exists <nome>` completos por cada policy existente antes do `create policy`. Sem `if exists`, migration falha se policy não existir; **usar** `if exists` sempre.

- [ ] **Step 3: Aplicar**

```
mcp__supabase-write__apply_migration
  name: empresa_members_rls
```

- [ ] **Step 4: Conferir**

```sql
-- Toda policy que agora usa can_access_empresa_regional
select tablename, policyname
from pg_policies
where schemaname='public'
  and (qual ilike '%can_access_empresa_regional%' or with_check ilike '%can_access_empresa_regional%')
order by tablename, policyname;
```

Expected: pelo menos 2 policies (select + modify) para cada uma das 13 tabelas = ~26 linhas.

- [ ] **Step 5: Teste de acesso — user admin ainda vê tudo, e viewer com backfill vê tudo**

```sql
-- Simular auth.uid() do admin
set local role authenticated;
set local request.jwt.claims to '{"sub": "<UUID_DO_ADMIN>"}';
select count(*) from public.jobs;    -- deve retornar 6
select count(*) from public.orcamentos; -- deve retornar 21

-- Simular auth.uid() de um non-admin (com backfill amplo)
set local request.jwt.claims to '{"sub": "<UUID_DE_NON_ADMIN>"}';
select count(*) from public.jobs;    -- deve retornar 6 (todos, backfill amplo)
```

Se falhar, revisar policies antes de continuar.

- [ ] **Step 6: NÃO commitar ainda** — commit final na Task 4.

---

### Task 4: Migration — Extensão do `handle_new_user` (metadata de convite)

**Files:**
- Create: `supabase/migrations/20260909000004_handle_new_user_empresa_members.sql`

**Interfaces:**
- Consumes: `empresa_members`, `regionais`, `empresas` (existentes).
- Produces: trigger `handle_new_user` ampliado — lê `raw_user_meta_data.permissoes` e cria linhas em `empresa_members`.

- [ ] **Step 1: Ler versão atual do `handle_new_user`**

Via MCP:
```sql
select prosrc from pg_proc where proname='handle_new_user' limit 1;
```

Anotar o corpo — vou preservar tudo que já faz (criar profile + tenant_members).

- [ ] **Step 2: Escrever migration com corpo estendido**

Criar `supabase/migrations/20260909000004_handle_new_user_empresa_members.sql`:

```sql
-- Motivo: Fase 2B — quando um user aceita o convite, o admin pode ter
-- pre-configurado permissoes de empresa/regional no metadata. Esta
-- migration estende handle_new_user para ler raw_user_meta_data.permissoes
-- e criar linhas em empresa_members.
--
-- Formato do metadata (grava no createConvite ou reinviteUser):
--   {
--     "permissoes": {
--       "escopo": "todas" | "personalizado",
--       "empresas": [   // apenas se escopo=personalizado
--         { "empresa_id": "<uuid>", "regionais": null | ["<uuid>", ...] }
--       ]
--     }
--   }
--   regionais=null significa "amplo" (regional_id=NULL em empresa_members).
--   regionais=[uuid, uuid, ...] cria uma linha por regional.
--
-- Aditivo: se metadata ausente ou malformado, o trigger nao cria linha
-- de empresa_members — o admin adiciona depois pela tela. Backward
-- compat com convites antigos.
--
-- Ver docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_nome text;
  v_role public.app_role;
  v_tenant_id uuid;
  v_permissoes jsonb;
  v_escopo text;
  v_empresas jsonb;
  v_empresa_entry jsonb;
  v_empresa_id uuid;
  v_regionais jsonb;
  v_regional_id uuid;
begin
  -- (mantem tudo que o handle_new_user ja fazia — criar profile + tenant_members
  -- do metadata pre-existente. Colar do prosrc atual, apenas adicionar o bloco
  -- final abaixo.)

  -- <copiar corpo atual aqui>

  -- --- Novo: aplica permissoes pre-configuradas no convite ------------
  v_permissoes := new.raw_user_meta_data -> 'permissoes';

  if v_permissoes is null then
    return new;  -- convite antigo ou sem metadata: nada a fazer
  end if;

  v_escopo := v_permissoes ->> 'escopo';

  if v_escopo = 'todas' then
    -- Cria 1 linha amplo por empresa ativa do tenant
    insert into public.empresa_members(tenant_id, user_id, empresa_id, regional_id, status, created_by)
    select v_tenant_id, new.id, e.id, null, 'ativo', null
    from public.empresas e
    where e.tenant_id = v_tenant_id and e.ativo = true
    on conflict on constraint uq_empresa_members do nothing;

  elsif v_escopo = 'personalizado' then
    v_empresas := v_permissoes -> 'empresas';
    if v_empresas is not null and jsonb_typeof(v_empresas) = 'array' then
      for v_empresa_entry in select * from jsonb_array_elements(v_empresas) loop
        v_empresa_id := (v_empresa_entry ->> 'empresa_id')::uuid;
        v_regionais := v_empresa_entry -> 'regionais';

        if v_regionais is null or jsonb_typeof(v_regionais) = 'null' then
          -- Amplo pra essa empresa
          insert into public.empresa_members(tenant_id, user_id, empresa_id, regional_id, status, created_by)
          values (v_tenant_id, new.id, v_empresa_id, null, 'ativo', null)
          on conflict on constraint uq_empresa_members do nothing;
        elsif jsonb_typeof(v_regionais) = 'array' then
          -- Restrito: uma linha por regional listada
          for v_regional_id in
            select (r ->> 0)::uuid from jsonb_array_elements(v_regionais) as t(r)
          loop
            insert into public.empresa_members(tenant_id, user_id, empresa_id, regional_id, status, created_by)
            values (v_tenant_id, new.id, v_empresa_id, v_regional_id, 'ativo', null)
            on conflict on constraint uq_empresa_members do nothing;
          end loop;
        end if;
      end loop;
    end if;
  end if;

  return new;
exception when others then
  -- Metadata malformado nao deve bloquear a criacao do user.
  -- Loga em audit_events e segue.
  insert into public.audit_events(tenant_id, user_id, acao, entidade_tipo, entidade_id, metadata)
  values (v_tenant_id, new.id, 'convite.permissoes_falhou', 'user', new.id::text,
          jsonb_build_object('erro', SQLERRM, 'permissoes_raw', v_permissoes));
  return new;
end $$;
```

**Nota crítica:** substituir `<copiar corpo atual aqui>` pelo corpo real do `handle_new_user`. O corpo atual cria `profile` + `tenant_members` a partir do `raw_user_meta_data`. Copiar EXATAMENTE do prosrc obtido no Step 1 pra não perder nada. `v_tenant_id`, `v_role`, `v_nome` provavelmente já são declaradas lá.

- [ ] **Step 3: Aplicar**

```
mcp__supabase-write__apply_migration
  name: handle_new_user_empresa_members
```

- [ ] **Step 4: Conferir função atualizada**

```sql
select prosrc from pg_proc where proname='handle_new_user' limit 1;
```

Expected: prosrc contém a nova lógica de `v_permissoes`.

- [ ] **Step 5: Commit ÚNICO das 4 migrations + tipos**

Antes do commit, adicionar tipo em `lib/types.ts`:

```ts
// ---------- Fase 2B: permissao por empresa ----------

export interface EmpresaMember {
  id: string;
  tenant_id: string;
  user_id: string;
  empresa_id: string;
  regional_id: string | null;  // null = acesso amplo à empresa
  status: TenantMemberStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

Adicionar após a interface `TenantMember` ou onde faça sentido semanticamente.

Commit:

```bash
git add supabase/migrations/20260909000001_empresa_members.sql \
        supabase/migrations/20260909000002_empresa_members_backfill.sql \
        supabase/migrations/20260909000003_empresa_members_rls.sql \
        supabase/migrations/20260909000004_handle_new_user_empresa_members.sql \
        lib/types.ts \
        docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md \
        docs/superpowers/plans/2026-09-09-empresa-members-permissoes.md
git commit -m "feat(permissoes): fundacao empresa_members (banco + RLS + trigger convite)

- empresa_members(user_id, empresa_id, regional_id nullable) + integridade
- can_access_empresa_regional() + helpers de listagem
- backfill amplo pra manter compat (todo user vira ampla nas empresas ativas)
- RLS das 13 tabelas passa a filtrar por can_access_empresa_regional
- handle_new_user le raw_user_meta_data.permissoes ao aceitar convite
- lib/types.ts ganha interface EmpresaMember"
```

---

### Task 5: Sessao ganha `empresasVisiveis` + cache

**Files:**
- Create: `lib/data/permissoes.ts`
- Modify: `lib/auth/session.ts` — usa `getPermissoesDoUser` cacheado
- Modify: `lib/types.ts` — `SessionContext` ganha `empresasVisiveis` + `regionaisVisiveisPorEmpresa`

**Interfaces:**
- Consumes: `empresa_members` + funções (Task 1), `getEmpresasByTenantCached` (já existe).
- Produces:
  - `SessionContext.empresasVisiveis: Empresa[]`
  - `SessionContext.regionaisVisiveisPorEmpresa: Map<string, "all" | string[]>`
  - `getPermissoesDoUserCached(userId, tenantId): Promise<PermissoesUser>`

- [ ] **Step 1: Criar `lib/data/permissoes.ts`**

```ts
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Permissoes de um usuario dentro de um tenant.
 * Materializa empresa_members com bypass de admin do tenant.
 *
 * Formato:
 * - empresaIds: ids das empresas que o user pode ver.
 * - regionaisPorEmpresa: por empresa, "all" = acesso amplo;
 *   array de UUIDs = restrito a essas regionais.
 */
export interface PermissoesUser {
  empresaIds: string[];
  regionaisPorEmpresa: Record<string, "all" | string[]>;
  isTenantAdmin: boolean;
}

async function fetchPermissoesDoUserUncached(
  userId: string,
  tenantId: string,
): Promise<PermissoesUser> {
  const supabase = createServiceClient();

  // Admin do tenant bypassa
  const { data: adminRow } = await supabase
    .from("tenant_members")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("role", "administrador")
    .eq("status", "ativo")
    .maybeSingle();

  if (adminRow) {
    // Admin: todas empresas ativas + all em cada
    const { data: empresas } = await supabase
      .from("empresas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true);

    const empresaIds = (empresas ?? []).map((e) => e.id);
    const regionaisPorEmpresa: Record<string, "all"> = {};
    for (const id of empresaIds) regionaisPorEmpresa[id] = "all";

    return { empresaIds, regionaisPorEmpresa, isTenantAdmin: true };
  }

  // Non-admin: lê empresa_members
  const { data: rows } = await supabase
    .from("empresa_members")
    .select("empresa_id, regional_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("status", "ativo");

  const empresaIds = new Set<string>();
  const regionaisPorEmpresa: Record<string, "all" | string[]> = {};

  for (const r of rows ?? []) {
    empresaIds.add(r.empresa_id as string);
    if (r.regional_id === null) {
      regionaisPorEmpresa[r.empresa_id as string] = "all";
    } else {
      const atual = regionaisPorEmpresa[r.empresa_id as string];
      if (atual === "all") continue; // já tem amplo
      if (Array.isArray(atual)) {
        atual.push(r.regional_id as string);
      } else {
        regionaisPorEmpresa[r.empresa_id as string] = [r.regional_id as string];
      }
    }
  }

  return {
    empresaIds: Array.from(empresaIds),
    regionaisPorEmpresa,
    isTenantAdmin: false,
  };
}

/**
 * Versão cacheada — TTL 5min. Invalidada por tag `user-permissions:{userId}`
 * nas actions de admin/usuarios que mexem em empresa_members.
 */
export function getPermissoesDoUserCached(
  userId: string,
  tenantId: string,
): Promise<PermissoesUser> {
  const cached = unstable_cache(
    () => fetchPermissoesDoUserUncached(userId, tenantId),
    ["permissoes-user", userId, tenantId],
    { revalidate: 300, tags: [`user-permissions:${userId}`] },
  );
  return cached();
}
```

- [ ] **Step 2: Ampliar `SessionContext` em `lib/types.ts`**

Adicionar após `empresas: Empresa[];`:

```ts
  /**
   * Empresas que o user tem permissao de ver (backfill dá amplo a todo
   * mundo no dia 1). Substitui `empresas` na maioria dos consumidores.
   * Admin do tenant vê todas as ativas do tenant automaticamente (bypass).
   */
  empresasVisiveis: Empresa[];
  /**
   * Por empresa, quais regionais o user pode ver.
   *   - "all": acesso amplo (regional_id=NULL em empresa_members)
   *   - string[]: restrito às regionais listadas
   * Se uma empresa nao aparece no mapa, o user nao tem acesso.
   */
  regionaisVisiveisPorEmpresa: Record<string, "all" | string[]>;
```

- [ ] **Step 3: Modificar `loadSession()` em `lib/auth/session.ts`**

Adicionar import:
```ts
import { getPermissoesDoUserCached, type PermissoesUser } from "@/lib/data/permissoes";
```

Após `const empresas = await getEmpresasByTenantCached(active.tenant.id);`, adicionar:

```ts
  // Fase 2B: materializa permissoes do user (bypass automatico de admin).
  const perm: PermissoesUser = await getPermissoesDoUserCached(
    profile.id,
    active.tenant.id,
  );

  const empresasVisiveis = empresas.filter((e) => perm.empresaIds.includes(e.id));
```

E incluir os campos no `return`:

```ts
  return {
    kind: "ok",
    session: {
      profile,
      memberships,
      activeTenant: active.tenant,
      activeRole: active.role,
      activeEmpresas,
      empresas,
      empresasVisiveis,
      regionaisVisiveisPorEmpresa: perm.regionaisPorEmpresa,
    },
  };
```

Também: sanitizar `idsSelecionados` contra `empresasVisiveis` — se cookie tem id que o user não pode ver, ignorar:

Substituir:
```ts
const activeEmpresas: Empresa[] = idsSelecionados
  .map((id) => empresas.find((e) => e.id === id))
  .filter((e): e is Empresa => e !== undefined);
```

Por:
```ts
const activeEmpresas: Empresa[] = idsSelecionados
  .map((id) => empresasVisiveis.find((e) => e.id === id))
  .filter((e): e is Empresa => e !== undefined);
```

- [ ] **Step 4: Ajustar mocks em `lib/permissoes.test.ts`**

Localizar os 2 objetos `sessionFake` (por volta das linhas 350-370) e adicionar aos dois:

```ts
    empresasVisiveis: [],
    regionaisVisiveisPorEmpresa: {},
```

- [ ] **Step 5: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Ambos limpos. Se aparecer erro em consumers, é esperado — a Task 6 e 7 vão migrar.

- [ ] **Step 6: Commit**

```bash
git add lib/data/permissoes.ts lib/auth/session.ts lib/types.ts lib/permissoes.test.ts
git commit -m "feat(sessao): SessionContext ganha empresasVisiveis + regionaisVisiveisPorEmpresa

- getPermissoesDoUserCached em lib/data/permissoes.ts (unstable_cache TTL 5min,
  tag user-permissions:{userId})
- loadSession() materializa empresasVisiveis (subset de empresas
  permitidas pelo user, com bypass de admin do tenant)
- Cookie active_empresa_ids sanitizado contra empresasVisiveis
- Mocks de permissoes.test.ts atualizados"
```

---

### Task 6: Dropdown de empresa ativa usa `empresasVisiveis`

**Files:**
- Modify: `components/ui/page-header-empresa-filter.tsx` — nada; recebe `session.empresas` como prop hoje
- Modify: as 7 telas com dropdown que passam `empresas={session.empresas}` — trocar por `empresas={session.empresasVisiveis}`

**Interfaces:**
- Consumes: `session.empresasVisiveis` (Task 5).
- Produces: user só vê no dropdown as empresas que tem permissão.

- [ ] **Step 1: Grep pelas telas que passam `session.empresas` pro PageHeader**

```bash
grep -rn "empresas={session.empresas}" "app/(app)" --include="*.tsx" --include="*.ts"
```

Expected: 7 arquivos (as telas com dropdown).

- [ ] **Step 2: Para cada arquivo, trocar por `empresasVisiveis`**

Padrão único a aplicar:

```diff
- empresas={session.empresas}
+ empresas={session.empresasVisiveis}
```

**Nota:** manter `session.empresas` (todas do tenant) NAS TELAS DE ADMIN (`/admin/empresas`, `/admin/usuarios`) porque admin precisa ver e gerenciar TODAS. O grep só deve retornar as 7 telas operacionais. Se aparecer alguma de `/admin/*`, NÃO trocar.

- [ ] **Step 3: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Testar visualmente (opcional)**

Se rodar `npm run dev`, entrar no `/orcamentos` como admin — dropdown mostra as 4 empresas (bypass admin retorna todas ativas).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)"
git commit -m "feat(filtros): dropdown de empresa usa empresasVisiveis (respeita permissao)"
```

---

### Task 7: `/admin/usuarios` — drawer de EDIÇÃO com seção "Acesso a empresas"

**Files:**
- Create: `app/(app)/admin/usuarios/editar-drawer.tsx` (novo — edição de usuário existente)
- Create: `app/(app)/admin/usuarios/acesso-empresas-editor.tsx` (componente reutilizável — usado no editar E no convidar)
- Modify: `app/(app)/admin/usuarios/actions.ts` — server actions `atualizarPermissoes`, `carregarPermissoes`
- Modify: `app/(app)/admin/usuarios/page.tsx` — cada linha vira clicável abrindo o drawer

**Interfaces:**
- Consumes: `empresa_members` (Task 1), `session.empresas` (todas do tenant, admin gerencia).
- Produces:
  - `AcessoEmpresasEditor` (componente).
  - Server actions `atualizarPermissoes(userId, dados)` e `carregarPermissoes(userId)`.
  - `EditarUsuarioDrawer` (drawer).

- [ ] **Step 1: Criar `AcessoEmpresasEditor` — componente reutilizável**

Este componente é a UI da seção "Acesso a empresas". Recebe empresas + regionais + estado inicial, expõe `onChange` com o estado atual pra o pai serializar.

Criar `app/(app)/admin/usuarios/acesso-empresas-editor.tsx`:

```tsx
"use client";

import * as React from "react";
import type { Empresa, Regional } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

export type AcessoEscopo = "todas" | "personalizado";

export type AcessoEmpresa = {
  empresaId: string;
  regionais: "all" | string[]; // "all" = amplo; array = restrito às ids
};

export type AcessoEmpresasEditorProps = {
  empresas: Pick<Empresa, "id" | "razao_social" | "nome_fantasia">[];
  regionais: Pick<Regional, "id" | "nome" | "empresa_id">[];
  /** Estado inicial. */
  escopo: AcessoEscopo;
  empresasEscolhidas: AcessoEmpresa[];
  onChange: (escopo: AcessoEscopo, empresas: AcessoEmpresa[]) => void;
};

export function AcessoEmpresasEditor({
  empresas,
  regionais,
  escopo,
  empresasEscolhidas,
  onChange,
}: AcessoEmpresasEditorProps) {
  const escolhidasPorId = new Map(empresasEscolhidas.map((e) => [e.empresaId, e]));

  const setEscopo = (novo: AcessoEscopo) => onChange(novo, empresasEscolhidas);

  const toggleEmpresa = (empresaId: string, ligada: boolean) => {
    if (ligada) {
      onChange(escopo, [
        ...empresasEscolhidas,
        { empresaId, regionais: "all" },
      ]);
    } else {
      onChange(
        escopo,
        empresasEscolhidas.filter((e) => e.empresaId !== empresaId),
      );
    }
  };

  const setRegionaisDaEmpresa = (
    empresaId: string,
    regionais: "all" | string[],
  ) => {
    onChange(
      escopo,
      empresasEscolhidas.map((e) =>
        e.empresaId === empresaId ? { ...e, regionais } : e,
      ),
    );
  };

  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Acesso a empresas</Label>

      <RadioGroup
        value={escopo}
        onValueChange={(v) => setEscopo(v as AcessoEscopo)}
        className="space-y-2"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="todas" id="escopo-todas" />
          <Label htmlFor="escopo-todas" className="cursor-pointer text-sm">
            Todas as empresas do tenant
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="personalizado" id="escopo-personalizado" />
          <Label
            htmlFor="escopo-personalizado"
            className="cursor-pointer text-sm"
          >
            Personalizado
          </Label>
        </div>
      </RadioGroup>

      {escopo === "personalizado" && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          {empresas.map((e) => {
            const escolhida = escolhidasPorId.get(e.id);
            const marcada = Boolean(escolhida);
            const nome = e.nome_fantasia ?? e.razao_social;
            const regionaisDaEmpresa = regionais.filter(
              (r) => r.empresa_id === e.id,
            );

            return (
              <div key={e.id} className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={marcada}
                    onCheckedChange={(c) => toggleEmpresa(e.id, c === true)}
                  />
                  <span className="text-sm font-medium">{nome}</span>
                </label>
                {marcada && escolhida && (
                  <div className="pl-6">
                    <RegionaisSubDropdown
                      empresaNome={nome}
                      regionais={regionaisDaEmpresa}
                      valor={escolhida.regionais}
                      onChange={(novo) => setRegionaisDaEmpresa(e.id, novo)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Sub-dropdown de regionais dentro do checkbox de empresa.
 * "all" = vazio + label "Todas"; ao marcar regionais especificas, vira restrito.
 */
function RegionaisSubDropdown({
  empresaNome,
  regionais,
  valor,
  onChange,
}: {
  empresaNome: string;
  regionais: Pick<Regional, "id" | "nome">[];
  valor: "all" | string[];
  onChange: (v: "all" | string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const label =
    valor === "all"
      ? "Todas as regionais"
      : valor.length === 0
        ? "Nenhuma regional"
        : valor.length === 1
          ? regionais.find((r) => r.id === valor[0])?.nome ?? "1 regional"
          : `${valor.length} regionais`;

  const toggle = (id: string, ligada: boolean) => {
    const atuais = valor === "all" ? [] : [...valor];
    if (ligada) {
      onChange([...atuais, id]);
    } else {
      const restante = atuais.filter((x) => x !== id);
      onChange(restante.length === 0 ? "all" : restante);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-between">
          <span className="text-xs">Regionais: {label}</span>
          <ChevronDown className="h-3 w-3 ml-2 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="pb-2 mb-2 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => onChange("all")}
          >
            Todas as regionais
          </Button>
        </div>
        <div className="space-y-1">
          {regionais.map((r) => {
            const checked = valor !== "all" && valor.includes(r.id);
            return (
              <label
                key={r.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => toggle(r.id, c === true)}
                />
                <span className="text-sm">{r.nome}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Verificar `RadioGroup` do shadcn existe**

```bash
ls components/ui/radio-group.tsx 2>&1
```

Se **não existir**, criar via CLI:
```bash
npx shadcn@latest add radio-group
```

- [ ] **Step 3: Server actions em `app/(app)/admin/usuarios/actions.ts`**

Adicionar imports (se ainda não têm):
```ts
import { revalidateTag } from "next/cache";
```

Adicionar functions:

```ts
export interface CarregarPermissoesResult {
  ok: true;
  escopo: "todas" | "personalizado";
  empresas: Array<{ empresa_id: string; regionais: "all" | string[] }>;
}

export async function carregarPermissoes(
  userId: string,
): Promise<CarregarPermissoesResult | { ok: false; message: string }> {
  const session = await requireAdmin();
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  const { data: rows, error } = await service
    .from("empresa_members")
    .select("empresa_id, regional_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("status", "ativo");

  if (error) {
    console.error("[usuarios.carregarPermissoes]", error.message);
    return { ok: false, message: "Nao foi possivel carregar permissoes." };
  }

  const { data: empresasTenant } = await service
    .from("empresas")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true);

  const empresaIdsDoTenant = new Set((empresasTenant ?? []).map((e) => e.id));

  const porEmpresa: Record<string, "all" | Set<string>> = {};
  for (const r of rows ?? []) {
    if (r.regional_id === null) {
      porEmpresa[r.empresa_id as string] = "all";
    } else {
      const atual = porEmpresa[r.empresa_id as string];
      if (atual === "all") continue;
      if (atual instanceof Set) atual.add(r.regional_id as string);
      else porEmpresa[r.empresa_id as string] = new Set([r.regional_id as string]);
    }
  }

  const empresas = Object.entries(porEmpresa).map(([empresa_id, regs]) => ({
    empresa_id,
    regionais: (regs === "all" ? "all" : Array.from(regs)) as "all" | string[],
  }));

  // Escopo "todas" = uma linha "all" por empresa ativa do tenant.
  const todasCobertas =
    empresas.length === empresaIdsDoTenant.size &&
    empresas.every((e) => e.regionais === "all");

  return {
    ok: true,
    escopo: todasCobertas ? "todas" : "personalizado",
    empresas,
  };
}

export async function atualizarPermissoes(
  userId: string,
  escopo: "todas" | "personalizado",
  empresasEscolhidas: Array<{
    empresa_id: string;
    regionais: "all" | string[];
  }>,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  // Se "todas", expande em uma linha 'all' por empresa ativa do tenant.
  let entradas = empresasEscolhidas;
  if (escopo === "todas") {
    const { data: empresasTenant } = await service
      .from("empresas")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true);
    entradas = (empresasTenant ?? []).map((e) => ({
      empresa_id: e.id,
      regionais: "all" as const,
    }));
  }

  // Delete tudo do user no tenant e recria (transacao no cliente Supabase
  // NAO existe fora de RPC; fazemos delete + insert em serie).
  const { error: delErr } = await service
    .from("empresa_members")
    .delete()
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (delErr) {
    console.error("[usuarios.atualizarPermissoes.delete]", delErr.message);
    return { ok: false, message: "Falha ao limpar permissoes anteriores." };
  }

  const toInsert: Array<{
    tenant_id: string;
    user_id: string;
    empresa_id: string;
    regional_id: string | null;
    status: "ativo";
  }> = [];
  for (const e of entradas) {
    if (e.regionais === "all") {
      toInsert.push({
        tenant_id: tenantId,
        user_id: userId,
        empresa_id: e.empresa_id,
        regional_id: null,
        status: "ativo",
      });
    } else {
      for (const r of e.regionais) {
        toInsert.push({
          tenant_id: tenantId,
          user_id: userId,
          empresa_id: e.empresa_id,
          regional_id: r,
          status: "ativo",
        });
      }
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await service.from("empresa_members").insert(toInsert);
    if (insErr) {
      console.error("[usuarios.atualizarPermissoes.insert]", insErr.message);
      return { ok: false, message: "Falha ao salvar permissoes." };
    }
  }

  await logAuditEvent({
    acao: "empresa_member.atualizado",
    tenantId,
    entidadeTipo: "user",
    entidadeId: userId,
    metadata: { escopo, empresas: entradas },
  });

  revalidateTag(`user-permissions:${userId}`);
  revalidatePath("/admin/usuarios");
  revalidatePath("/admin/empresas");

  return { ok: true, message: "Permissoes atualizadas." };
}
```

- [ ] **Step 4: Criar `EditarUsuarioDrawer`**

Criar `app/(app)/admin/usuarios/editar-drawer.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Empresa, Regional } from "@/lib/types";
import { atualizarPermissoes, carregarPermissoes } from "./actions";
import {
  AcessoEmpresasEditor,
  type AcessoEscopo,
  type AcessoEmpresa,
} from "./acesso-empresas-editor";

export type EditarUsuarioDrawerProps = {
  userId: string;
  userNome: string;
  userEmail: string;
  empresas: Pick<Empresa, "id" | "razao_social" | "nome_fantasia">[];
  regionais: Pick<Regional, "id" | "nome" | "empresa_id">[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditarUsuarioDrawer(props: EditarUsuarioDrawerProps) {
  const { userId, userNome, userEmail, empresas, regionais, open, onOpenChange } =
    props;
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [escopo, setEscopo] = React.useState<AcessoEscopo>("todas");
  const [empresasEscolhidas, setEmpresasEscolhidas] = React.useState<
    AcessoEmpresa[]
  >([]);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    carregarPermissoes(userId)
      .then((res) => {
        if (res.ok) {
          setEscopo(res.escopo);
          setEmpresasEscolhidas(
            res.empresas.map((e) => ({
              empresaId: e.empresa_id,
              regionais: e.regionais,
            })),
          );
        } else {
          setError(res.message);
        }
      })
      .finally(() => setLoading(false));
  }, [open, userId]);

  function handleSalvar() {
    setError(null);
    startTransition(async () => {
      const res = await atualizarPermissoes(
        userId,
        escopo,
        empresasEscolhidas.map((e) => ({
          empresa_id: e.empresaId,
          regionais: e.regionais,
        })),
      );
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Permissões de {userNome}</DialogTitle>
          <DialogDescription>
            {userEmail} · Defina a quais empresas e regionais este usuário tem
            acesso.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Carregando permissões...
            </p>
          ) : (
            <AcessoEmpresasEditor
              empresas={empresas}
              regionais={regionais}
              escopo={escopo}
              empresasEscolhidas={empresasEscolhidas}
              onChange={(novoEscopo, novoEmpresas) => {
                setEscopo(novoEscopo);
                setEmpresasEscolhidas(novoEmpresas);
              }}
            />
          )}
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={pending || loading}>
            {pending ? "Salvando..." : "Salvar permissões"}
          </Button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Ampliar `/admin/usuarios/page.tsx` — carregar empresas + regionais + linhas clicáveis**

Adicionar imports e fetches:

No `Promise.all` do page, adicionar 2 queries:
```ts
service.from("empresas").select("id, razao_social, nome_fantasia").eq("tenant_id", session.activeTenant.id).eq("ativo", true).order("nome_fantasia"),
service.from("regionais").select("id, nome, empresa_id").eq("tenant_id", session.activeTenant.id).eq("ativo", true).order("nome"),
```

Passar empresas+regionais como props pra um componente `UsuariosLista` novo (client). Cada linha vira clicável, abre o `EditarUsuarioDrawer`.

**Simplificação:** este step tem escopo grande. Criar client component wrapper:
`app/(app)/admin/usuarios/usuarios-lista.tsx` que recebe rows + empresas + regionais e renderiza tudo (é o que hoje está inline em `page.tsx`). Ao clicar num row, abre o drawer.

- [ ] **Step 6: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/admin/usuarios/"
git commit -m "feat(admin/usuarios): drawer de edicao com secao Acesso a empresas

- AcessoEmpresasEditor: componente reutilizavel (radio todas/personalizado
  + checkboxes por empresa + sub-dropdown de regionais)
- EditarUsuarioDrawer: drawer que carrega permissoes existentes e salva
- Server actions carregarPermissoes + atualizarPermissoes
  (delete+insert dentro do tenant; revalidateTag user-permissions:{userId})
- Auditoria em empresa_member.atualizado"
```

---

### Task 8: `/admin/usuarios` convidar-drawer ganha seção "Acesso a empresas"

**Files:**
- Modify: `app/(app)/admin/usuarios/convidar-drawer.tsx`
- Modify: `app/(app)/admin/usuarios/actions.ts` — action de criar convite recebe permissões e passa como metadata

**Interfaces:**
- Consumes: `AcessoEmpresasEditor` (Task 7), lista de empresas + regionais (páginas passam).
- Produces: convite com `user_metadata.permissoes` — o trigger da Task 4 aplica.

- [ ] **Step 1: Ler convidar-drawer.tsx atual**

Ver a estrutura do form. Anotar onde termina "Papel no tenant" — a nova seção vai antes do rodapé "Cancelar/Enviar convite".

- [ ] **Step 2: Adicionar seção AcessoEmpresasEditor**

Estado interno adicional:
```tsx
const [escopo, setEscopo] = React.useState<AcessoEscopo>("todas");
const [empresasEscolhidas, setEmpresasEscolhidas] = React.useState<AcessoEmpresa[]>([]);
```

Renderizar componente entre o campo Role e o rodapé:
```tsx
<AcessoEmpresasEditor
  empresas={empresas}
  regionais={regionais}
  escopo={escopo}
  empresasEscolhidas={empresasEscolhidas}
  onChange={(novoEscopo, novoEmp) => {
    setEscopo(novoEscopo);
    setEmpresasEscolhidas(novoEmp);
  }}
/>
```

No handleSubmit, passar como parte do formData:
```tsx
formData.set("escopo_empresas", escopo);
formData.set("empresas_escolhidas", JSON.stringify(empresasEscolhidas));
```

- [ ] **Step 3: Ampliar action `criarConvite` em `actions.ts`**

Ler `escopo_empresas` e `empresas_escolhidas` do formData. Montar `raw_user_meta_data.permissoes`:

```ts
const escopo = (formData.get("escopo_empresas")?.toString() ?? "todas") as "todas" | "personalizado";
const escolhidasRaw = formData.get("empresas_escolhidas")?.toString();
let empresasEscolhidas: Array<{ empresa_id: string; regionais: "all" | string[] }> = [];
if (escolhidasRaw) {
  try {
    empresasEscolhidas = JSON.parse(escolhidasRaw).map((e: { empresaId: string; regionais: "all" | string[] }) => ({
      empresa_id: e.empresaId,
      regionais: e.regionais,
    }));
  } catch {
    return { ok: false, message: "Formato invalido em empresas escolhidas." };
  }
}

// Monta o objeto que vai no user_metadata:
const permissoes = escopo === "todas"
  ? { escopo: "todas" }
  : { escopo: "personalizado", empresas: empresasEscolhidas };
```

Passar pra `inviteUserByEmail`:

```ts
await service.auth.admin.inviteUserByEmail(email, {
  data: {
    ...userDataAntigo,  // preservar o que ja passava (nome, role, tenant_id)
    permissoes,
  },
  redirectTo: ...,
});
```

**Não muda:** o trigger `handle_new_user` (Task 4) já sabe ler `permissoes` do `raw_user_meta_data`.

- [ ] **Step 4: Ampliar action `reenviarConvite`**

Se o design permite recarga, aplicar mesma lógica. Se o design mantém as permissões antigas, apenas manter — a linha de `empresa_members` já foi criada na primeira aceitação.

**Ruling:** manter permissões antigas no reenvio. Se admin quiser mudar, usa a tela de edição depois que o user aceitar.

- [ ] **Step 5: Passar empresas/regionais pro `ConvidarUsuarioDrawer`**

Em `/admin/usuarios/page.tsx` ou `usuarios-lista.tsx`, passar as listas como prop pro drawer.

- [ ] **Step 6: Type-check + build**

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/admin/usuarios/"
git commit -m "feat(admin/usuarios): convite ganha secao Acesso a empresas

- Drawer de convite renderiza AcessoEmpresasEditor (default: todas)
- criarConvite serializa permissoes em user_metadata do inviteUserByEmail
- handle_new_user (migration Task 4) aplica ao aceitar o convite
- Compat: convites antigos (sem metadata.permissoes) nao criam empresa_members;
  admin adiciona depois via drawer de edicao"
```

---

### Task 9: `/admin/empresas` card — linha resumo "N usuários" + modal read-only

**Files:**
- Modify: `app/(app)/admin/empresas/empresa-card.tsx` — adiciona linha resumo
- Modify: `app/(app)/admin/empresas/page.tsx` — fetch contagem/users por empresa
- Create: `app/(app)/admin/empresas/usuarios-modal.tsx` — modal read-only

**Interfaces:**
- Consumes: `empresa_members` (Task 1), `profiles`, `EmpresaRow`.
- Produces: linha "N usuários com acesso · Ver detalhes" no rodapé de cada card. Modal com lista.

- [ ] **Step 1: `/admin/empresas/page.tsx` — fetch dos users por empresa**

Adicionar ao `Promise.all`:

```ts
service.from("empresa_members")
  .select("empresa_id, user_id, regional_id, status")
  .eq("tenant_id", tenantId)
  .eq("status", "ativo"),
```

Agrupar client-side:
```ts
type UserAcessoResumo = {
  user_id: string;
  nome: string;
  email: string;
  escopo: "todas" | "restrito";
  regionais: string[]; // se restrito
};

const acessoPorEmpresa = new Map<string, UserAcessoResumo[]>();
// buscar profiles dos user_ids distintos
// buscar regionais pra resolver nomes
// montar Map: empresa_id -> UserAcessoResumo[]
```

Passar `usuariosAcesso={acessoPorEmpresa.get(empresa.id) ?? []}` como prop pro `EmpresaCard`.

- [ ] **Step 2: `EmpresaCard` ganha resumo no rodapé**

Após a lista de regionais (ainda dentro do card):

```tsx
{usuariosAcesso.length > 0 && (
  <div
    className="border-t border-border px-6 py-3 flex items-center justify-between hover:bg-accent/40 cursor-pointer"
    onClick={() => setModalUsuariosOpen(true)}
  >
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Users className="h-3.5 w-3.5" />
      <span>
        <span className="font-medium text-foreground">
          {usuariosAcesso.length}
        </span>{" "}
        {usuariosAcesso.length === 1 ? "usuário" : "usuários"} com acesso
      </span>
    </div>
    <span className="text-xs font-medium text-california-red">
      Ver detalhes →
    </span>
  </div>
)}
```

- [ ] **Step 3: Criar `usuarios-modal.tsx`**

Modal read-only com lista de users:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type UsuarioAcesso = {
  user_id: string;
  nome: string;
  email: string;
  escopo: "todas" | "restrito";
  regionais: string[];
};

export function UsuariosAcessoModal({
  open,
  onOpenChange,
  empresaNome,
  usuarios,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaNome: string;
  usuarios: UsuarioAcesso[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quem tem acesso a {empresaNome}</DialogTitle>
          <DialogDescription>
            {usuarios.length} usuário{usuarios.length === 1 ? "" : "s"} com
            permissão ativa.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border max-h-96 overflow-y-auto">
          {usuarios.map((u) => (
            <li key={u.user_id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {u.nome}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {u.email}
                </p>
              </div>
              <div className="text-xs text-muted-foreground shrink-0 text-right">
                {u.escopo === "todas" ? (
                  <span className="text-emerald-700">Todas regionais</span>
                ) : (
                  <span>{u.regionais.join(", ") || "Sem regional"}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="pt-3 border-t border-border">
          <Link href="/admin/usuarios" prefetch={false}>
            <Button variant="outline" className="w-full">
              Editar acesso em Usuários →
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Adicionar no `EmpresaCard`:
```tsx
<UsuariosAcessoModal
  open={modalUsuariosOpen}
  onOpenChange={setModalUsuariosOpen}
  empresaNome={empresa.nome_fantasia ?? empresa.razao_social}
  usuarios={usuariosAcesso}
/>
```

E adicionar state:
```tsx
const [modalUsuariosOpen, setModalUsuariosOpen] = React.useState(false);
```

- [ ] **Step 4: Type-check + build**

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/admin/empresas/"
git commit -m "feat(admin/empresas): card mostra 'N usuarios com acesso' + modal read-only

- Fetch de empresa_members ativos por empresa
- Linha resumo no rodape do card (clicavel)
- Modal read-only com lista de usuarios + link 'Editar em Usuarios'"
```

---

### Task 10: Actions de admin/empresas invalidam cache de user-permissions

**Files:**
- Modify: `app/(app)/admin/empresas/actions.ts` — ao desativar empresa, invalidar todos os user-permissions afetados

**Interfaces:**
- Consumes: `empresa_members`, actions existentes de empresa.
- Produces: cache invalidado quando admin muda estado da empresa.

- [ ] **Step 1: Adicionar invalidação em `desativarEmpresa` e `reativarEmpresa`**

Ambas actions precisam invalidar cache dos users que têm linha na empresa afetada. Após o UPDATE, buscar `distinct user_id from empresa_members where empresa_id=X`, chamar `revalidateTag(\`user-permissions:${userId}\`)` pra cada.

Snippet:

```ts
// Após revalidatePath("/admin/empresas"):
const service = createServiceClient();
const { data: usersAfetados } = await service
  .from("empresa_members")
  .select("user_id")
  .eq("empresa_id", id);

const uniqueUserIds = Array.from(
  new Set((usersAfetados ?? []).map((r) => r.user_id as string)),
);
for (const uid of uniqueUserIds) {
  revalidateTag(`user-permissions:${uid}`);
}
```

Aplicar em `desativarEmpresa` e `reativarEmpresa`.

Nas actions de `criarEmpresa`/`atualizarEmpresa`/`marcarPrincipal`: **não** invalidar (não muda quem tem acesso ao quê).

Nas actions de regional (`criarRegional`, `editarRegional`, `inativarRegional`, `reativarRegional`): **não** invalidar (permissões referenciam regional_id, mas se a regional some/volta, o subset ativo do user simplesmente muda automaticamente na próxima leitura — TTL 5min é aceitável).

- [ ] **Step 2: Type-check + build**

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/admin/empresas/actions.ts"
git commit -m "chore(admin/empresas): invalidar cache user-permissions ao (des)ativar empresa

Users com linha em empresa_members apontando pra essa empresa tem
sua sessao materializada com dados antigos. Ao desativar empresa,
o TTL de 5min seria aceitavel — mas invalidar imediatamente e trivial
e evita janela de comportamento inconsistente."
```

---

### Task 11: Teste de aceitação manual completo

**Files:**
- Nenhum (validação end-to-end).

**Interfaces:**
- Consumes: todo o pipeline.
- Produces: confirmação de que o comportamento bate com o design.

- [ ] **Step 1: Aplicação em produção (deploy Vercel)**

Push (que já deve ter subido) → Vercel deploy → esperar Ready.

- [ ] **Step 2: Login como admin (Antonio)**

- Ir em `/admin/empresas`
- Confirmar: as 4 empresas aparecem no organograma
- Confirmar: cada card mostra "N usuários com acesso · Ver detalhes"
- Clicar em "Ver detalhes" da Agência → lista todos os users viewer/operator
- Fechar

- [ ] **Step 3: Ir em `/admin/usuarios` — editar um user (ex: Débora, financeiro)**

- Clicar num user pra abrir drawer de edição
- Confirmar: radio "Todas as empresas" está marcado (backfill)
- Trocar pra "Personalizado", desmarcar Hitlab
- Salvar
- Confirmar toast/refresh

- [ ] **Step 4: Login como Débora (financeiro)**

- Ir em `/orcamentos` (ou `/financeiro/fluxo-caixa`)
- Confirmar: dropdown de empresas mostra 3 (não 4 — Hitlab sumiu)
- Selecionar apenas "Agência California" — lista de dados aparece
- Nenhuma linha de "Hitlab" aparece em nenhuma listagem

- [ ] **Step 5: Voltar ao admin, restringir Débora a apenas regional NE**

- Editar Débora → Personalizado → Agência California → sub-dropdown → marcar só "NE"
- Salvar

- [ ] **Step 6: Login como Débora de novo**

- Ir em `/financeiro/desembolsos` (ou `/contas-a-pagar`)
- Confirmar: só aparecem desembolsos/contas com regional NE
- Se criar uma conta avulsa com rateio, o combobox de regionais só oferece NE (via filtro no client, deve ser automático)

- [ ] **Step 7: Testar convite com metadata**

- Como admin, convidar um user com escopo Personalizado + CCH + regional Doca
- Copiar link do convite dos logs (ou mailtrap)
- Aceitar convite noutra sessão
- Confirmar via SQL:
  ```sql
  select em.*, e.nome_fantasia
  from empresa_members em
  join empresas e on e.id = em.empresa_id
  where em.user_id = '<uuid_do_novo_user>';
  ```
  Expected: 1 linha com empresa_id=CCH, regional_id=<uuid_da_Doca>.

- [ ] **Step 8: Documentar resultados no ledger SDD (ou no commit final)**

Anotar qualquer surpresa. Se algo falhou, voltar à task correspondente.

---

### Task 12: Documentação final + review

**Files:**
- Modify: `docs/09-identidade-visual-ui.md` (se houver mudanças de UX que valem doc)
- Nothing outros — spec e plan já são fontes.

- [ ] **Step 1: Rodar advisors**

```
mcp__supabase__get_advisors  type: security
mcp__supabase__get_advisors  type: performance
```

Confirmar: nenhum novo alerta em `empresa_members` ou funções. `function_search_path_mutable` nas novas funções deve estar OK (já usamos `set search_path = public`).

- [ ] **Step 2: Grep final por consumidores de `session.empresas`**

```bash
grep -rn "session\.empresas\b" "app/(app)" --include="*.tsx" --include="*.ts" | grep -v "session\.empresasVisiveis"
```

Cada hit remanescente é intencional (admin gerencia todas)? Confirmar caso a caso.

- [ ] **Step 3: Confirmar count final via MCP**

```sql
-- Estado real: quantos users, quantas linhas
select
  (select count(*) from tenant_members where status='ativo') as tm_ativos,
  (select count(*) from empresa_members where status='ativo') as em_ativos,
  (select count(distinct user_id) from empresa_members where status='ativo') as users_com_permissao,
  (select count(*) from tenant_members where role='administrador' and status='ativo') as admins;
```

Esperado: `em_ativos` = (users não-admin) × 4 empresas ativas = ~92 se 23 users viewer/operator.

- [ ] **Step 4: Commit final "seção 2B concluída"**

```bash
git commit --allow-empty -m "chore(fase-2b): permissao por empresa/regional concluida

Todas as tasks 1-11 aplicadas e testadas.
- Migrations 20260909000001-4 aplicadas (empresa_members + backfill + RLS + trigger)
- Session context materializa empresasVisiveis + regionaisVisiveisPorEmpresa
- /admin/usuarios drawer de edicao + convite integrado
- /admin/empresas card mostra usuarios com acesso
- Auditoria + invalidacao de cache"
```

---

## Nota sobre execução

- **Tasks 1-4** (banco) são sequenciais e devem ser aplicadas em ordem. Cada uma é conferida via MCP antes de avançar. Commit único no fim (Task 4).
- **Task 5** (session) desbloqueia Tasks 6-9.
- **Tasks 6, 7, 8, 9, 10** (UI) podem ser feitas em qualquer ordem depois de Task 5.
- **Task 11** (teste manual) é validação end-to-end.
- **Task 12** (docs) fecha.

Fora do escopo (fase futura):
- Convite bulk.
- UI de auditoria (log de mudanças).
- Notificação por e-mail quando permissão muda.
- Grupos/roles reutilizáveis como templates.
