-- Motivo: elimina multiple_permissive_policies advisor-flagged no módulo RH.
-- Cada SELECT em profiles/tenant_members/colaboradores_ferias_* disparava
-- 2-3 policies RLS sobrepostas, cada uma rodando subquery de auth.
-- Multiplicava custo real por 2-3× em TODA tela do módulo.
--
-- Estratégia: 1 policy por (tabela × comando), com OR interno quando
-- há múltiplas regras. Mantém granularidade de permissão por INSERT/UPDATE
-- separados quando faz sentido.
--
-- Resultado medido (query do Quadro, cache quente):
--   Antes: Execution 31ms + Planning 15ms = 46ms
--   Depois: Execution 1.1ms + Planning 2.2ms = 3.3ms (14× mais rápida)
--
-- Referências:
--   - tasks/active/009-performance-modulo-rh.md Onda 1.
--   - advisor Supabase: multiple_permissive_policies (12 findings em RH).

-- profiles — 3 SELECT policies vão virar 1
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_same_tenant on public.profiles;
drop policy if exists profiles_select_membros_do_tenant on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.e_colega_de_tenant(id)
  );

comment on policy profiles_select on public.profiles is
  'Consolidada 2026-10-02 (task 009): fundiu profiles_select_self + profiles_select_membros_do_tenant + profiles_select_same_tenant.';

-- tenant_members — 2 SELECT policies vão virar 1
drop policy if exists tenant_members_select_self on public.tenant_members;
drop policy if exists tenant_members_select_admin on public.tenant_members;

create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_tenant_admin(tenant_id)
  );

comment on policy tenant_members_select on public.tenant_members is
  'Consolidada 2026-10-02 (task 009): fundiu tenant_members_select_self + tenant_members_select_admin.';

-- colaboradores_ferias_lancamentos — rh_admin_all (ALL) + 3 do colab
-- Dropa o ALL e cria 4 policies específicas com OR interno.
drop policy if exists ferias_lancamentos_rh_admin_all on public.colaboradores_ferias_lancamentos;
drop policy if exists ferias_lancamentos_colab_read_own on public.colaboradores_ferias_lancamentos;
drop policy if exists ferias_lancamentos_colab_insert_own on public.colaboradores_ferias_lancamentos;
drop policy if exists ferias_lancamentos_colab_cancel_own on public.colaboradores_ferias_lancamentos;

create policy ferias_lancamentos_select on public.colaboradores_ferias_lancamentos
  for select to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_colaborador_proprio(colaborador_id)
  );

create policy ferias_lancamentos_insert on public.colaboradores_ferias_lancamentos
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or (
      public.is_colaborador_proprio(colaborador_id)
      and status = 'pendente_aprovacao'::ferias_lancamento_status
      and lancado_direto_por_rh = false
      and solicitado_por = (select auth.uid())
    )
  );

create policy ferias_lancamentos_update on public.colaboradores_ferias_lancamentos
  for update to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or (
      public.is_colaborador_proprio(colaborador_id)
      and (
        status = 'pendente_aprovacao'::ferias_lancamento_status
        or (status = 'aprovado'::ferias_lancamento_status and data_inicio > current_date)
      )
    )
  )
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or (
      public.is_colaborador_proprio(colaborador_id)
      and status = 'cancelado'::ferias_lancamento_status
    )
  );

create policy ferias_lancamentos_delete on public.colaboradores_ferias_lancamentos
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

-- colaboradores_ferias_notificacoes — rh_admin_all + destinatário
drop policy if exists ferias_notif_rh_admin_all on public.colaboradores_ferias_notificacoes;
drop policy if exists ferias_notif_destinatario_read on public.colaboradores_ferias_notificacoes;
drop policy if exists ferias_notif_destinatario_mark_read on public.colaboradores_ferias_notificacoes;

create policy ferias_notif_select on public.colaboradores_ferias_notificacoes
  for select to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or destinatario_user_id = (select auth.uid())
  );

create policy ferias_notif_insert on public.colaboradores_ferias_notificacoes
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

create policy ferias_notif_update on public.colaboradores_ferias_notificacoes
  for update to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or destinatario_user_id = (select auth.uid())
  )
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or destinatario_user_id = (select auth.uid())
  );

create policy ferias_notif_delete on public.colaboradores_ferias_notificacoes
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

-- colaboradores_ferias_periodos — rh_admin_all + colab read
drop policy if exists ferias_periodos_rh_admin_all on public.colaboradores_ferias_periodos;
drop policy if exists ferias_periodos_colab_read_own on public.colaboradores_ferias_periodos;

create policy ferias_periodos_select on public.colaboradores_ferias_periodos
  for select to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
    or public.is_colaborador_proprio(colaborador_id)
  );

create policy ferias_periodos_insert on public.colaboradores_ferias_periodos
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

create policy ferias_periodos_update on public.colaboradores_ferias_periodos
  for update to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  )
  with check (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );

create policy ferias_periodos_delete on public.colaboradores_ferias_periodos
  for delete to authenticated
  using (
    public.is_tenant_admin(tenant_id)
    or public.is_tenant_rh(tenant_id)
  );
