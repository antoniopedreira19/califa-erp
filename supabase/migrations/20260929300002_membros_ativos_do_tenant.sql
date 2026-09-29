-- =====================================================================
-- A lista de pessoas dos formulários (Equipe, GPs Responsáveis, produtor,
-- responsável da verba…) chegava só com o próprio usuário para quem não é
-- administrador.
--
-- `listActiveMembers` (lib/data/members.ts) lia primeiro `tenant_members`,
-- e a RLS dela só deixa ler a própria linha (`tenant_members_select_self`)
-- ou, para o administrador, todas (`tenant_members_select_admin`). O GP
-- Teste Claude, simulado em 29/09/2026, via 1 membro e 86 perfis. Foi o
-- que a produção relatou: GP e produtor não conseguiam acrescentar nem
-- tirar ninguém da Equipe do projeto — a lista só tinha eles mesmos, e
-- quem já estava na Equipe nem aparecia para sair.
--
-- A correção não abre `tenant_members` (o papel de cada um continua só
-- para o administrador): uma função devolve id e nome dos membros ativos
-- do tenant, e só para quem é membro ativo dele. É a mesma régua da
-- política `profiles_select_membros_do_tenant` (`e_colega_de_tenant`),
-- que desde 17/09/2026 já deixa qualquer membro ler o perfil dos colegas.
--
-- Aditiva: função nova. Nenhuma política muda.
-- =====================================================================

create or replace function public.membros_ativos_do_tenant(p_tenant_id uuid)
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.nome::text
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.tenant_id = p_tenant_id
     and tm.status = 'ativo'
     and p.ativo
     and exists (
       select 1
         from public.tenant_members eu
        where eu.tenant_id = p_tenant_id
          and eu.user_id = (select auth.uid())
          and eu.status = 'ativo'
     )
   order by p.nome;
$$;

revoke all on function public.membros_ativos_do_tenant(uuid) from public, anon;
grant execute on function public.membros_ativos_do_tenant(uuid) to authenticated;
