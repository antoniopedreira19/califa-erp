-- As cinco policies reescritas na 20261003200002 passam a chamar
-- `(select auth.uid())` em vez de `auth.uid()`.
--
-- A 200002 copiou a forma que as policies já tinham desde a 20260909000003
-- (`can_access_empresa_regional(auth.uid(), …)`), e o advisor de
-- performance acusou `auth_rls_initplan` nas cinco: `auth.uid()` solto é
-- reavaliado a cada linha; dentro de um `select` vira initPlan, uma vez
-- por consulta (docs/PERFORMANCE.md, regra das policies).
--
-- Mesma regra, mesmo resultado — só a forma da chamada muda. As
-- `*_select` de projetos, orçamentos e jobs ficam como estão: não foram
-- tocadas aqui.

alter policy projetos_modify on public.projetos
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(id)
        else true
      end
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(id)
        else true
      end
    )
  );

alter policy orcamentos_modify on public.orcamentos
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  );

alter policy jobs_modify on public.jobs
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  );

alter policy pp_select on public.pedidos_compra
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (
      session_role() <> 'freelancer'
      or exists (
        select 1 from public.jobs j
        where j.id = pedidos_compra.job_id
          and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

alter policy pp_modify on public.pedidos_compra
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (
      session_role() <> 'freelancer'
      or exists (
        select 1 from public.jobs j
        where j.id = pedidos_compra.job_id
          and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (
      session_role() <> 'freelancer'
      or exists (
        select 1 from public.jobs j
        where j.id = pedidos_compra.job_id
          and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );
