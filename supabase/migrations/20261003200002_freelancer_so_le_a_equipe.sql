-- O freelancer volta a ler só os projetos da equipe dele — em projetos,
-- orçamentos, jobs e PPs.
--
-- O VAZAMENTO. A migration 20260909000003 (empresa_members, Fase 2B)
-- recriou as policies destas tabelas em dois pares: `*_select` (FOR
-- SELECT, com a cláusula do freelancer) e `*_modify` (FOR ALL, SEM ela).
-- Só que FOR ALL também vale para SELECT, e policies permissivas se somam
-- por OU: a `*_modify` deixava passar toda linha das empresas do usuário,
-- e a restrição da `*_select` não tinha efeito. Em `pedidos_compra` foi
-- pior: a `pp_select` foi recriada sem a cláusula que a 20260903120001
-- tinha posto.
--
-- O spec daquela fase pedia o contrário ("Só vê projeto se estiver
-- associado E se tiver acesso à empresa dele. Nenhuma regra anula a
-- outra." — docs/superpowers/specs/2026-09-09-empresa-members-permissoes-
-- design.md, item 4).
--
-- Medido em 03/10/2026, simulando a RLS como um freelancer real SEM
-- equipe nenhuma: 31 projetos, 61 orçamentos, 32 jobs da lista e 71 PPs
-- visíveis. Versões e itens vinham zerados (as policies delas não têm
-- par FOR ALL), então as listas mostravam tudo e o detalhe vinha vazio.
--
-- A REGRA (Tiago, 03/10/2026): para o freelancer, o "Meus" é a equipe do
-- projeto — e o freelancer não tem a chave "Meus/Todos", a lista dele é
-- o que a RLS entrega. A Equipe é a de `is_freelancer_do_projeto`
-- (migration 20261003200001).
--
-- O QUE MUDA. Só a cláusula do freelancer entra, no USING e no WITH CHECK
-- das cinco policies — a mesma que as `*_select` já têm. Para os outros
-- papéis o CASE dá `true` e nada muda. Autorizado pelo Tiago em
-- 03/10/2026, sabendo que os 4 freelancers reais (nenhum em equipe) ficam
-- com as listas vazias até entrarem na Equipe de um projeto.
--
-- `alter policy` mantém nome, comando, papéis (`authenticated`) e o
-- caráter permissivo; GRANTs das tabelas não mudam.

-- ============================================================
-- projetos / orçamentos / jobs: a `*_modify` (FOR ALL) ganha a cláusula
-- ============================================================

alter policy projetos_modify on public.projetos
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(id)
        else true
      end
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
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
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
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
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  )
  with check (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
    and (
      case session_role()
        when 'freelancer' then is_freelancer_do_projeto(projeto_id)
        else true
      end
    )
  );

-- ============================================================
-- pedidos_compra: a PP é do projeto do job (job_id é NOT NULL)
-- ============================================================

alter policy pp_select on public.pedidos_compra
  using (
    tenant_id in (select current_tenant_ids())
    and can_access_empresa_regional(auth.uid(), empresa_id, null::uuid)
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
    and can_access_empresa_regional(auth.uid(), empresa_id, null::uuid)
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
    and can_access_empresa_regional(auth.uid(), empresa_id, null::uuid)
    and (
      session_role() <> 'freelancer'
      or exists (
        select 1 from public.jobs j
        where j.id = pedidos_compra.job_id
          and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );
