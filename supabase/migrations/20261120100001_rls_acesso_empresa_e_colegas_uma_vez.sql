-- Regras de leitura (RLS): acesso por empresa/regional e "colega de tenant"
-- checados uma vez por consulta, e não uma vez por linha.
--
-- Continuação da 20261116990001 (mesmo problema, as duas funções que ficaram).
--
-- Diagnóstico (19–20/11/2026):
--   * A lista de PPs do Contas a Pagar (SELECT_PP_DO_FINANCEIRO, páginas de
--     1.000) era a última rota lenta: 208 chamadas por tarde, média 1,6 s,
--     ~100 acima de 2 s, máximo 4,3 s.
--   * Medida por partes, como o administrador e como o financeiro: a PP sozinha
--     custa 40 ms; os anexos com nota +470 ms, os eventos +270 ms, o job +120 ms
--     e os 8 nomes de pessoas +110 ms. Todos pagam as mesmas duas checagens por
--     linha: can_access_empresa_regional (em pedidos_compra, jobs, projetos…) e
--     e_colega_de_tenant (em profiles). As duas são SECURITY DEFINER, não são
--     "inlinadas" e rodavam uma vez para cada PP, job, evento, nota e nome.
--   * Simulação antes de aplicar: a lista de 1.000 PPs cai de ~1,0 s para
--     ~0,25 s. Vale para toda tela que lê essas tabelas ou mostra nome de pessoa.
--
-- A troca, mecânica e só nas policies de leitura (FOR SELECT):
--   can_access_empresa_regional(uid, E, NULL)
--     -> E IN (empresas_com_acesso_de_admin()) OR E IN (empresas_do_membro())
--   can_access_empresa_regional(uid, E, R)
--     -> E IN (empresas_com_acesso_de_admin())
--        OR E IN (empresas_do_membro_sem_regional())
--        OR (R IS NULL AND E IN (empresas_do_membro()))
--        OR (E, R) IN (empresas_e_regionais_do_membro())
--   e_colega_de_tenant(id) -> id IN (colegas_de_tenant())
-- Tudo em COALESCE(…, false): a função antiga nunca devolvia nulo, e assim a
-- forma nova também não.
-- As funções novas são o corpo das antigas devolvendo o conjunto, sem o
-- argumento da linha: rodam uma vez por consulta (InitPlan/hashed SubPlan).
--
-- Quem vê o quê NÃO muda. Conferido antes de aplicar:
--   * As 15 policies avaliadas linha a linha, texto antigo × novo, como cada um
--     dos 210 usuários do sistema: 406.421 linhas vistas nas duas formas, zero
--     divergências.
--   * Nenhum usuário tem hoje vínculo restrito a uma regional; esse caminho foi
--     conferido à parte por tabela-verdade: 81 combinações (9 situações de
--     vínculo × empresa × regional, com e sem regional na linha), zero
--     divergências.
--   * Nenhuma policy nega essas funções.
--   * ALTER POLICY troca só o USING. As policies de escrita, as de Storage e as
--     funções que chamam can_access_empresa_regional por dentro ficam como estão;
--     as duas funções antigas continuam existindo.
--
-- lock_timeout: ALTER POLICY trava a tabela por um instante; se alguma estiver
-- ocupada, a migration falha inteira em vez de enfileirar as leituras de todos.

set local lock_timeout = '5s';


create function public.empresas_com_acesso_de_admin()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select e.id
  from public.tenant_members tm
  join public.empresas e on e.tenant_id = tm.tenant_id
  where tm.user_id = (select auth.uid())
    and tm.role = 'administrador'
    and tm.status = 'ativo';
$function$;

create function public.empresas_do_membro()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select em.empresa_id
  from public.empresa_members em
  where em.user_id = (select auth.uid())
    and em.status = 'ativo';
$function$;

create function public.empresas_do_membro_sem_regional()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select em.empresa_id
  from public.empresa_members em
  where em.user_id = (select auth.uid())
    and em.status = 'ativo'
    and em.regional_id is null;
$function$;

create function public.empresas_e_regionais_do_membro()
returns table(empresa_id uuid, regional_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select em.empresa_id, em.regional_id
  from public.empresa_members em
  where em.user_id = (select auth.uid())
    and em.status = 'ativo'
    and em.regional_id is not null;
$function$;

create function public.colegas_de_tenant()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select colega.user_id
  from public.tenant_members eu
  join public.tenant_members colega on colega.tenant_id = eu.tenant_id
  where eu.user_id = (select auth.uid())
    and eu.status = 'ativo'
    and colega.status = 'ativo';
$function$;

revoke all on function public.empresas_com_acesso_de_admin() from public, anon;
revoke all on function public.empresas_do_membro() from public, anon;
revoke all on function public.empresas_do_membro_sem_regional() from public, anon;
revoke all on function public.empresas_e_regionais_do_membro() from public, anon;
revoke all on function public.colegas_de_tenant() from public, anon;
grant execute on function public.empresas_com_acesso_de_admin() to authenticated, service_role;
grant execute on function public.empresas_do_membro() to authenticated, service_role;
grant execute on function public.empresas_do_membro_sem_regional() to authenticated, service_role;
grant execute on function public.empresas_e_regionais_do_membro() to authenticated, service_role;
grant execute on function public.colegas_de_tenant() to authenticated, service_role;


alter policy cartoes_credito_select on public.cartoes_credito
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false)));

alter policy avulsas_select on public.contas_avulsas
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro_sem_regional() AS empresas_do_membro_sem_regional)) OR ((regional_id IS NULL) AND (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))) OR ((empresa_id, regional_id) IN ( SELECT r.empresa_id, r.regional_id FROM public.empresas_e_regionais_do_membro() r))), false)));

alter policy rec_select on public.contas_avulsas_recorrentes
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false)));

alter policy contas_bancarias_select on public.contas_bancarias
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((empresa_id IS NULL) OR COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false))));

alter policy desembolsos_select on public.desembolsos
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false) AND ((criado_por = ( SELECT auth.uid() AS uid)) OR (( SELECT public.session_role() AS session_role) = ANY (ARRAY['administrador'::public.app_role, 'financeiro'::public.app_role])))));

alter policy faturamentos_select on public.faturamentos
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false)));

alter policy jobs_select on public.jobs
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro_sem_regional() AS empresas_do_membro_sem_regional)) OR ((regional_id IS NULL) AND (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))) OR ((empresa_id, regional_id) IN ( SELECT r.empresa_id, r.regional_id FROM public.empresas_e_regionais_do_membro() r))), false) AND
CASE ( SELECT public.session_role() AS session_role)
    WHEN 'freelancer'::public.app_role THEN public.is_freelancer_do_projeto(projeto_id)
    ELSE true
END));

alter policy lancamentos_select on public.lancamentos_financeiros
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND (COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro_sem_regional() AS empresas_do_membro_sem_regional)) OR ((regional_id IS NULL) AND (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))) OR ((empresa_id, regional_id) IN ( SELECT r.empresa_id, r.regional_id FROM public.empresas_e_regionais_do_membro() r))), false) OR ((empresa_id IS NULL) AND (transferencia_id IS NOT NULL) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))) OR ((empresa_id IS NULL) AND (origem = 'devolucao_bancaria'::public.origem_lancamento) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))))));

alter policy orcamentos_select on public.orcamentos
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro_sem_regional() AS empresas_do_membro_sem_regional)) OR ((regional_id IS NULL) AND (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))) OR ((empresa_id, regional_id) IN ( SELECT r.empresa_id, r.regional_id FROM public.empresas_e_regionais_do_membro() r))), false) AND
CASE ( SELECT public.session_role() AS session_role)
    WHEN 'freelancer'::public.app_role THEN public.is_freelancer_do_projeto(projeto_id)
    ELSE true
END));

alter policy pp_select on public.pedidos_compra
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = pedidos_compra.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy ppae_select on public.pedidos_compra_a_emitir
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = pedidos_compra_a_emitir.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy pp_verba_devolucoes_select on public.pp_verba_devolucoes
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))), false)));

alter policy profiles_select on public.profiles
  using (((id = ( SELECT auth.uid() AS uid)) OR COALESCE((id IN ( SELECT public.colegas_de_tenant() AS colegas_de_tenant)), false)));

alter policy projetos_select on public.projetos
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro_sem_regional() AS empresas_do_membro_sem_regional)) OR ((regional_id IS NULL) AND (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))) OR ((empresa_id, regional_id) IN ( SELECT r.empresa_id, r.regional_id FROM public.empresas_e_regionais_do_membro() r))), false) AND
CASE ( SELECT public.session_role() AS session_role)
    WHEN 'freelancer'::public.app_role THEN public.is_freelancer_do_projeto(id)
    ELSE true
END));

alter policy titulos_select on public.titulos_receber
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND COALESCE(((empresa_id IN ( SELECT public.empresas_com_acesso_de_admin() AS empresas_com_acesso_de_admin)) OR (empresa_id IN ( SELECT public.empresas_do_membro_sem_regional() AS empresas_do_membro_sem_regional)) OR ((regional_id IS NULL) AND (empresa_id IN ( SELECT public.empresas_do_membro() AS empresas_do_membro))) OR ((empresa_id, regional_id) IN ( SELECT r.empresa_id, r.regional_id FROM public.empresas_e_regionais_do_membro() r))), false)));
