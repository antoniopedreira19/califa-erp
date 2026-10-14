-- =====================================================================
-- Decisão 170 (Tiago, 13/10/2026): o campo de GP só oferece quem pode ser
-- GP, e o envio para abertura trava quando o GP do orçamento não pode.
--
-- Pode ser GP quem é membro ativo com o papel GP (`gerente_producao`) ou
-- Administrador. O mapa de 13/10/2026 achou três produtores cadastrados
-- como "GPs Responsáveis" de projeto — o campo listava todos os membros —
-- e um deles virou GP de job. E a lista de GP do orçamento lia a tabela
-- `projeto_responsaveis` inteira, sem separar o GP (`papel = 'gp'`) dos
-- acréscimos à Equipe (`papel = 'equipe'`, desde 02/09/2026): 30 produtores
-- e 4 freelancers apareciam como opção de GP.
--
--   gps_ativos_do_tenant(tenant) — lista do campo "GPs Responsáveis" do
--     projeto e conferência do papel no envio para abertura.
--   gps_do_projeto(projeto) — lista do campo "GP Responsável" do
--     orçamento: os GPs Responsáveis do projeto que podem ser GP.
--
-- Mesma régua de `membros_ativos_do_tenant` e `produtores_ativos_do_tenant`:
-- só id e nome, e só para quem é membro ativo do tenant. O papel dos outros
-- continua fechado em `tenant_members`.
--
-- Aditiva: duas funções novas. Nenhuma tabela nem política muda.
-- =====================================================================

create or replace function public.gps_ativos_do_tenant(p_tenant_id uuid)
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
     and tm.role in ('gerente_producao', 'administrador')
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

comment on function public.gps_ativos_do_tenant(uuid) is
  'Id e nome dos membros ativos que podem ser GP: papel GP ou Administrador (decisão 170). Só para quem é membro ativo do tenant.';

revoke all on function public.gps_ativos_do_tenant(uuid) from public, anon;
grant execute on function public.gps_ativos_do_tenant(uuid) to authenticated;

create or replace function public.gps_do_projeto(p_projeto_id uuid)
returns table (id uuid, nome text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.nome::text
    from public.projeto_responsaveis r
    join public.projetos pr on pr.id = r.projeto_id
    join public.tenant_members tm on tm.user_id = r.profile_id and tm.tenant_id = r.tenant_id
    join public.profiles p on p.id = r.profile_id
   where r.projeto_id = p_projeto_id
     and r.papel = 'gp'
     and tm.status = 'ativo'
     and tm.role in ('gerente_producao', 'administrador')
     and p.ativo
     and exists (
       select 1
         from public.tenant_members eu
        where eu.tenant_id = pr.tenant_id
          and eu.user_id = (select auth.uid())
          and eu.status = 'ativo'
     )
   order by p.nome;
$$;

comment on function public.gps_do_projeto(uuid) is
  'GPs Responsáveis do projeto (papel gp) que podem ser GP — papel GP ou Administrador, ativos (decisão 170). Lista do campo GP do orçamento. Só para quem é membro ativo do tenant do projeto.';

revoke all on function public.gps_do_projeto(uuid) from public, anon;
grant execute on function public.gps_do_projeto(uuid) to authenticated;
