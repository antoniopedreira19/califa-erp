-- Perfil de colega visível para todo membro ativo do tenant
-- =========================================================
--
-- Contexto (17/09/2026). Um GP abriu "Enviar job para abertura" e o
-- pop-up mostrava "GP Responsável — não informado" e "Produtor
-- Responsável — não informado", com o aviso "Complete antes de abrir o
-- job". O botão "Confirmar dados" não fazia nada: o formulário tratava
-- responsável sem nome como cadastro incompleto e travava o envio. O
-- orçamento estava completo — quem faltava era a LEITURA.
--
-- A RLS de `profiles` tinha só duas portas de SELECT:
--   * `profiles_select_self`        — o próprio perfil;
--   * `profiles_select_same_tenant` — perfis do mesmo tenant, mas SÓ
--     quando quem lê é `administrador`.
--
-- Enquanto todo mundo era administrador isso não aparecia. Desde
-- setembro/2026 existem GP, produtor, financeiro e freelancer de
-- verdade, e para eles TODO embed `profiles!...(nome)` volta nulo — são
-- 42 consultas no app (GP e produtor do orçamento e do job, "criado
-- por", "aprovada por", "pago por", responsável da verba...). O nome do
-- colega não é dado sigiloso dentro da agência: é o que essas telas
-- exibem o tempo todo.
--
-- ⚠️ A política NÃO pode consultar `tenant_members` direto. A expressão
-- de uma policy roda com os privilégios de quem faz a consulta, e a RLS
-- de `tenant_members` só deixa cada um ver o PRÓPRIO vínculo (e o admin
-- ver todos). Escrita com um `exists` sobre `tenant_members`, a política
-- enxerga a linha de quem lê e não a do colega — e continua devolvendo
-- nulo. Foi o que aconteceu na primeira tentativa desta migration. Por
-- isso a checagem vai num SECURITY DEFINER, no mesmo molde de
-- `is_tenant_member` / `is_tenant_admin`.
--
-- Nada é removido aqui. A política de administrador continua no lugar —
-- ela passa a ser um subconjunto desta, e cabe ao Tiago decidir se quer
-- apagá-la depois (remoção é mudança destrutiva e não se aplica
-- sozinha). Sem GRANT novo em `profiles`: `authenticated` já tem SELECT,
-- e `anon` continua sem nada.

create or replace function public.e_colega_de_tenant(p_perfil_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tenant_members eu
    join public.tenant_members colega
      on colega.tenant_id = eu.tenant_id
    where eu.user_id = (select auth.uid())
      and eu.status = 'ativo'
      and colega.user_id = p_perfil_id
      and colega.status = 'ativo'
  );
$$;

comment on function public.e_colega_de_tenant(uuid) is
  'Quem está logado divide um tenant ativo com este perfil? SECURITY DEFINER porque a RLS de tenant_members esconde o vínculo dos outros de quem não é administrador.';

revoke execute on function public.e_colega_de_tenant(uuid) from public;
revoke execute on function public.e_colega_de_tenant(uuid) from anon;
grant execute on function public.e_colega_de_tenant(uuid) to authenticated;
grant execute on function public.e_colega_de_tenant(uuid) to service_role;

create policy profiles_select_membros_do_tenant
  on public.profiles
  for select
  using (public.e_colega_de_tenant(profiles.id));

comment on policy profiles_select_membros_do_tenant on public.profiles is
  'Membro ativo do tenant lê o perfil dos demais membros ativos. Substitui na prática a profiles_select_same_tenant, que exigia administrador e deixava GP, produtor, financeiro e freelancer sem o nome dos colegas em todo embed profiles!...(nome).';
