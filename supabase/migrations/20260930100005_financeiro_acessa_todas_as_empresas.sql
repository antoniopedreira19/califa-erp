-- Decisão 132, §8 (30/09/2026) — o financeiro passa a ter acesso a todas as
-- empresas, inclusive a Ventura.
--
-- Pedido do Tiago em 30/09/2026: "tanto os usuários do financeiro quanto
-- administradores deverão ter acesso a todas as empresas".
--
-- Por que faltava: em 16/09 o acesso do financeiro foi marcado como "todas"
-- na tela de usuários, que grava uma linha por empresa existente naquele
-- momento. A Ventura nasceu em 24/09 e ficou de fora. A RLS de
-- contas_avulsas (can_access_empresa_regional) recusava título da Ventura
-- para o financeiro, e a folha de setembro tem três linhas 100% Ventura.
--
-- O que faz: para cada usuário ativo com papel financeiro, cria acesso amplo
-- (regional nula = todas as regionais) a cada empresa do tenant em que ele
-- ainda não tem linha nenhuma. Linha que já existe (acesso restrito a
-- algumas regionais, ou desativado) fica como está. Administrador não precisa
-- de linha: o papel já libera todas as empresas em
-- can_access_empresa_regional, inclusive as que forem criadas depois.
--
-- Registra em audit_events como a tela de usuários faz
-- (empresa_member.atualizado), com as empresas acrescentadas.
--
-- Fica de fora, para decisão do Tiago: gerentes de produção e produtores
-- também marcados como "todas" em 16/09, que estão sem a Ventura, e uma regra
-- para empresas criadas daqui em diante.

do $$
declare
  v_ator constant uuid := '3a933b18-156d-48b3-b100-a8099292b1c2'; -- Tiago Mendonça
  n integer;
begin
  insert into public.empresa_members (tenant_id, user_id, empresa_id, regional_id, status, created_by)
  select tm.tenant_id, tm.user_id, e.id, null, 'ativo', v_ator
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id and p.ativo
    join public.empresas e on e.tenant_id = tm.tenant_id
   where tm.role = 'financeiro'
     and tm.status = 'ativo'
     and not exists (
       select 1 from public.empresa_members em
        where em.user_id = tm.user_id and em.empresa_id = e.id
     );
  get diagnostics n = row_count;
  raise notice 'Acessos criados: %', n;

  -- now() é o instante da transação: pega exatamente as linhas criadas acima.
  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  select em.tenant_id, v_ator, 'empresa_member.atualizado', 'user', em.user_id::text,
         jsonb_build_object(
           'escopo', 'todas',
           'empresas', (
             select jsonb_agg(jsonb_build_object('empresa_id', x.empresa_id, 'regionais', 'all'))
               from public.empresa_members x
              where x.user_id = em.user_id and x.status = 'ativo' and x.regional_id is null
           ),
           'adicionadas', jsonb_agg(em.empresa_id),
           'origem', 'migration 20260930100005 (decisão 132, §8)'
         )
    from public.empresa_members em
   where em.created_at = now()
     and em.created_by = v_ator
   group by em.tenant_id, em.user_id;

  -- Nenhum usuário ativo do financeiro pode ficar sem alguma empresa.
  select count(*) into n
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id and p.ativo
    join public.empresas e on e.tenant_id = tm.tenant_id
   where tm.role = 'financeiro'
     and tm.status = 'ativo'
     and not exists (
       select 1 from public.empresa_members em
        where em.user_id = tm.user_id and em.empresa_id = e.id
     );
  if n <> 0 then
    raise exception 'Ainda há % par(es) usuário do financeiro × empresa sem acesso.', n;
  end if;
end;
$$;
