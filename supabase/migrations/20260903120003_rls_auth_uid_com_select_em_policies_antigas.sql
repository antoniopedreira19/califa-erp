-- Corrige `auth.uid()` sem `select` em 9 policies antigas da fundacao.
--
-- Advisor `auth_rls_initplan` reportou que policies criadas nas tasks
-- 001/002/004 usam `auth.uid()` direto no using/with_check. Postgres
-- re-avalia a funcao por linha; padrao correto e `(select auth.uid())`
-- — avaliado uma vez por statement. Regra H do docs/PERFORMANCE.md.
--
-- Migration puramente aditiva: nada muda de comportamento, so a forma
-- como o planner avalia a chamada. Feito agora porque estamos revendo
-- toda a superficie de RLS na Task 5 do projeto de permissoes — pegar
-- a divida velha junto e mais barato que voltar depois.

-- ---------- profiles ----------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
for select
using (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists profiles_select_same_tenant on public.profiles;
create policy profiles_select_same_tenant on public.profiles
for select
using (
  exists (
    select 1
    from public.tenant_members tm_self
    join public.tenant_members tm_other on tm_other.tenant_id = tm_self.tenant_id
    where tm_self.user_id = (select auth.uid())
      and tm_self.status = 'ativo'
      and tm_self.role = 'administrador'
      and tm_other.user_id = profiles.id
      and tm_other.status = 'ativo'
  )
);

-- ---------- tenant_members ----------
drop policy if exists tenant_members_select_self on public.tenant_members;
create policy tenant_members_select_self on public.tenant_members
for select
using (user_id = (select auth.uid()));

-- ---------- audit_events ----------
drop policy if exists audit_events_select_self on public.audit_events;
create policy audit_events_select_self on public.audit_events
for select
using (actor_user_id = (select auth.uid()));

drop policy if exists audit_events_insert_self on public.audit_events;
create policy audit_events_insert_self on public.audit_events
for insert
with check (
  actor_user_id = (select auth.uid())
  and (tenant_id is null or is_tenant_member(tenant_id))
);

-- ---------- clientes ----------
drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes
for insert
with check (
  is_tenant_member(tenant_id)
  and (
    created_by is null
    or created_by = (select auth.uid())
  )
);

-- ---------- fornecedores ----------
drop policy if exists fornecedores_insert on public.fornecedores;
create policy fornecedores_insert on public.fornecedores
for insert
with check (
  is_tenant_member(tenant_id)
  and (
    created_by is null
    or created_by = (select auth.uid())
  )
);

-- ---------- orcamento_importacoes ----------
drop policy if exists importacoes_insert on public.orcamento_importacoes;
create policy importacoes_insert on public.orcamento_importacoes
for insert
with check (
  is_tenant_member(tenant_id)
  and (
    created_by is null
    or created_by = (select auth.uid())
  )
);
