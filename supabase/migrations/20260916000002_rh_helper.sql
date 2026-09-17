-- =====================================================================
-- RH — Fase 1b: helper public.is_tenant_rh(uuid)
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Depende de 20260916000001_rh_role.sql estar aplicado (o valor 'rh' do
-- enum app_role precisa estar committed antes que esta função possa ser
-- criada).
--
-- Cria a função helper is_tenant_rh(uuid), espelho fiel de
-- is_tenant_admin(uuid) — mesma consulta, mesma semântica de segurança
-- (SECURITY DEFINER + set search_path). Diferença única: filtro
-- tm.role = 'rh'.
--
-- Serve como base das policies RLS de todas as tabelas do módulo RH
-- (colaboradores, colaboradores_alocacoes, colaboradores_salarios,
-- folhas_pagamento, folhas_pagamento_alocacoes, niveis), sempre no
-- formato:
--
--   is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)
--
-- Aditivo do começo ao fim: nenhum DROP, nenhuma linha existente é
-- tocada. Nenhuma policy é criada aqui — elas nascem nas migrations
-- seguintes do módulo.
--
-- Convenção do projeto: policies usam (select auth.uid()) em vez de
-- auth.uid() direto, para evitar re-avaliação por linha. Aqui dentro do
-- helper a chamada é escalar (uma vez por invocação), mas mantemos
-- (select auth.uid()) para simetria com is_tenant_admin.
--
-- Ver docs/modulos/rh/03-modelo-de-dados.md — seção "Role 'rh' e helper
-- de banco".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Helper is_tenant_rh(uuid)
-- ---------------------------------------------------------------------

create or replace function public.is_tenant_rh(p_tenant_id uuid)
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
      and tm.role = 'rh'
      and p.ativo = true
  );
$$;


-- ---------------------------------------------------------------------
-- 2. Grants
-- ---------------------------------------------------------------------
--
-- Função nova nasce com EXECUTE para PUBLIC (que inclui anon).
-- O guard is_tenant_rh serve pra RLS de authenticated; anon nunca deve
-- conseguir invocar (mesmo que sem sessão retornaria false, evitamos
-- superfície de ataque).

revoke all on function public.is_tenant_rh(uuid) from public, anon;
grant execute on function public.is_tenant_rh(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Comment
-- ---------------------------------------------------------------------

comment on function public.is_tenant_rh(uuid) is
  'True se o usuario autenticado for membro ativo com role rh no tenant informado. Padrao espelhado de is_tenant_admin(uuid). Usada em policies RLS do modulo RH junto com is_tenant_admin via OR.';
