-- Motivo: Fase 2B — RLS das 13 tabelas com empresa_id passa a respeitar
-- empresa_members via can_access_empresa_regional. Admin bypassa
-- (dentro da funcao). tenant_id continua no predicado como defesa em
-- profundidade. Backfill (20260909000002) garante que ninguem perde
-- acesso no dia 1.
--
-- Padroes:
--   * Tabelas SEM regional_id (contas_bancarias, cartoes_credito,
--     faturamentos, pp_verba_devolucoes, pedidos_compra,
--     contas_avulsas_recorrentes, desembolsos): can_access(...NULL).
--     Ruling: desembolsos nao tem coluna regional_id (verificado em
--     information_schema); plan/spec assumiam presenca. Filtro fica
--     por empresa apenas.
--   * Tabelas COM regional_id (contas_avulsas, lancamentos_financeiros,
--     titulos_receber): can_access(...regional_id).
--   * jobs / orcamentos / projetos: usam can_access(regional_id) +
--     AND com regra existente de freelancer (is_freelancer_do_projeto).
--
-- Para cada tabela: dropa policies antigas e cria novas consolidadas.
-- Ver docs/superpowers/specs/2026-09-09-empresa-members-permissoes-design.md

-- ============================================================
-- Tabelas SEM regional_id
-- ============================================================

-- cartoes_credito
drop policy if exists cartoes_credito_select on public.cartoes_credito;
drop policy if exists cartoes_credito_insert on public.cartoes_credito;
drop policy if exists cartoes_credito_update on public.cartoes_credito;
drop policy if exists cartoes_credito_delete on public.cartoes_credito;

create policy cartoes_credito_select on public.cartoes_credito for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );
create policy cartoes_credito_modify on public.cartoes_credito for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- contas_avulsas_recorrentes
drop policy if exists rec_select on public.contas_avulsas_recorrentes;
drop policy if exists rec_insert on public.contas_avulsas_recorrentes;
drop policy if exists rec_update on public.contas_avulsas_recorrentes;
drop policy if exists rec_delete on public.contas_avulsas_recorrentes;

create policy rec_select on public.contas_avulsas_recorrentes for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );
create policy rec_modify on public.contas_avulsas_recorrentes for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- contas_bancarias
drop policy if exists contas_bancarias_select on public.contas_bancarias;
drop policy if exists contas_bancarias_insert on public.contas_bancarias;
drop policy if exists contas_bancarias_update on public.contas_bancarias;

create policy contas_bancarias_select on public.contas_bancarias for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );
create policy contas_bancarias_modify on public.contas_bancarias for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- faturamentos
drop policy if exists faturamentos_select on public.faturamentos;
drop policy if exists faturamentos_insert on public.faturamentos;
drop policy if exists faturamentos_update on public.faturamentos;

create policy faturamentos_select on public.faturamentos for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );
create policy faturamentos_modify on public.faturamentos for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- pedidos_compra
drop policy if exists pp_select on public.pedidos_compra;
drop policy if exists pp_insert on public.pedidos_compra;
drop policy if exists pp_update on public.pedidos_compra;
drop policy if exists pp_delete on public.pedidos_compra;

create policy pp_select on public.pedidos_compra for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );
create policy pp_modify on public.pedidos_compra for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- pp_verba_devolucoes
drop policy if exists pp_verba_devolucoes_select on public.pp_verba_devolucoes;
drop policy if exists pp_verba_devolucoes_insert on public.pp_verba_devolucoes;
drop policy if exists pp_verba_devolucoes_update on public.pp_verba_devolucoes;

create policy pp_verba_devolucoes_select on public.pp_verba_devolucoes for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );
create policy pp_verba_devolucoes_modify on public.pp_verba_devolucoes for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- desembolsos (nao tem coluna regional_id — filtra so por empresa)
drop policy if exists desembolsos_select on public.desembolsos;
drop policy if exists desembolsos_insert on public.desembolsos;
drop policy if exists desembolsos_update on public.desembolsos;
drop policy if exists desembolsos_delete on public.desembolsos;

create policy desembolsos_select on public.desembolsos for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );
create policy desembolsos_modify on public.desembolsos for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null)
  );

-- ============================================================
-- Tabelas COM regional_id (sem freelancer)
-- ============================================================

-- contas_avulsas
drop policy if exists avulsas_select on public.contas_avulsas;
drop policy if exists avulsas_insert on public.contas_avulsas;
drop policy if exists avulsas_update on public.contas_avulsas;
drop policy if exists avulsas_delete on public.contas_avulsas;

create policy avulsas_select on public.contas_avulsas for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );
create policy avulsas_modify on public.contas_avulsas for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );

-- lancamentos_financeiros
drop policy if exists lancamentos_select on public.lancamentos_financeiros;
drop policy if exists lancamentos_insert on public.lancamentos_financeiros;
drop policy if exists lancamentos_update on public.lancamentos_financeiros;

create policy lancamentos_select on public.lancamentos_financeiros for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );
create policy lancamentos_modify on public.lancamentos_financeiros for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );

-- titulos_receber
drop policy if exists titulos_select on public.titulos_receber;
drop policy if exists titulos_insert on public.titulos_receber;
drop policy if exists titulos_update on public.titulos_receber;

create policy titulos_select on public.titulos_receber for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );
create policy titulos_modify on public.titulos_receber for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );

-- ============================================================
-- Tabelas COM regional_id + AND freelancer (jobs/orcamentos/projetos)
-- ============================================================

-- jobs
drop policy if exists jobs_select on public.jobs;
drop policy if exists jobs_insert on public.jobs;
drop policy if exists jobs_update on public.jobs;

create policy jobs_select on public.jobs for select to authenticated
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
create policy jobs_modify on public.jobs for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );

-- orcamentos
drop policy if exists orcamentos_select on public.orcamentos;
drop policy if exists orcamentos_insert on public.orcamentos;
drop policy if exists orcamentos_update on public.orcamentos;

create policy orcamentos_select on public.orcamentos for select to authenticated
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
create policy orcamentos_modify on public.orcamentos for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );

-- projetos (usa id do proprio projeto pra is_freelancer)
drop policy if exists projetos_select on public.projetos;
drop policy if exists projetos_insert on public.projetos;
drop policy if exists projetos_update on public.projetos;

create policy projetos_select on public.projetos for select to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(id)
        else true
      end
    )
  );
create policy projetos_modify on public.projetos for all to authenticated
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  );
