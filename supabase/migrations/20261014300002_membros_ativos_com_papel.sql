-- =====================================================================
-- Membros ativos com o papel — decisão 174 (14/10/2026)
--
-- O pop-up "Equipe" do job e da visão agregada agrupa as pessoas por
-- papel (GPs, Produtores, Freelancers), e a lista "Adicionar pessoa" diz o
-- papel de cada uma. `membros_ativos_do_tenant` devolve só id e nome (a RLS
-- de `tenant_members` mostra só a própria linha para quem não é
-- administrador). Esta é a mesma função com o papel ao lado — o que
-- `gps_ativos_do_tenant` (170) e `produtores_ativos_do_tenant` (168) já
-- dizem por separado. Só responde a quem é membro ativo do tenant.
-- =====================================================================

create or replace function public.membros_ativos_com_papel(p_tenant_id uuid)
returns table(id uuid, nome text, papel text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.nome::text, tm.role::text
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

comment on function public.membros_ativos_com_papel(uuid) is
  'Decisão 174: id, nome e papel dos membros ativos, para a Equipe do job e do projeto. Só para quem é membro ativo do tenant.';

revoke all on function public.membros_ativos_com_papel(uuid) from public, anon;
grant execute on function public.membros_ativos_com_papel(uuid) to authenticated;
