-- =====================================================================
-- O campo "Produtor Responsável" do orçamento listava TODOS os membros
-- ativos do tenant — 97 pessoas em 13/10/2026, com administradores,
-- financeiro, RH e os 48 GPs. A lista vinha de `membros_ativos_do_tenant`
-- desde quando o produtor ainda não era papel próprio; hoje é (`produtor`
-- no `app_role`, 31 pessoas ativas).
--
-- Decisão 168 (Tiago, 13/10/2026): o campo mostra só quem tem o papel
-- Produtor. Quem já está gravado como produtor de um orçamento sem ter o
-- papel (1 freelancer, 1 administradora e 7 GPs em orçamentos reais) fica como
-- está: a tela acrescenta o nome gravado à lista na edição, e o servidor só
-- confere o papel quando o produtor muda.
--
-- Mesma régua de `membros_ativos_do_tenant`: devolve só id e nome, e só
-- para quem é membro ativo do tenant. O papel dos outros continua fechado
-- em `tenant_members` (a RLS dela só abre a própria linha para quem não é
-- administrador) — a função revela apenas quem é produtor, que é o que a
-- própria lista já mostra.
--
-- Aditiva: função nova. Nenhuma tabela nem política muda.
-- =====================================================================

create or replace function public.produtores_ativos_do_tenant(p_tenant_id uuid)
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
     and tm.role = 'produtor'
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

comment on function public.produtores_ativos_do_tenant(uuid) is
  'Id e nome dos membros ativos com o papel Produtor — a lista do campo "Produtor Responsável" do orçamento e do envio para abertura (13/10/2026). Só para quem é membro ativo do tenant.';

revoke all on function public.produtores_ativos_do_tenant(uuid) from public, anon;
grant execute on function public.produtores_ativos_do_tenant(uuid) to authenticated;
