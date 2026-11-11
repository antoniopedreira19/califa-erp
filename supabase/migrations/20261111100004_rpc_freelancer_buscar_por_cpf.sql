-- RPC: busca freelancer por CPF dentro de um tenant, bypassando a RLS de
-- freelancers (que esconde cadastros de quem não é admin/rh/financeiro
-- nem responsavel_id direto).
--
-- Contexto: o endpoint /api/freelancers/buscar-por-cpf é usado pelo
-- NovaSolicitacaoDialog pra detectar na hora que o GP digita um CPF
-- já cadastrado — isso muda o form pro modo "revisando_historico" e
-- envia freelancer_id junto da solicitação, evitando que ela caia como
-- "contratação" quando deveria ser "renovação".
--
-- O endpoint fazia `supabase.from("freelancers").select(...)` com o
-- cliente server, que respeita a RLS do usuário logado. Quando um GP
-- (Teila) criava solicitação pra freela que não era responsabilidade
-- dela (Matheus, responsavel=Lufa), a query retornava vazio e o form
-- passava pela criação sem detectar o cadastro — reproduzindo o mesmo
-- bug do trigger (fix: 20261111100001).
--
-- Esta função isola a busca via SECURITY DEFINER com guard explícito:
-- precisa ser membro do tenant (is_tenant_member). Não vaza entre
-- tenants nem expõe dado pra não-membro. Retorna só id e nome_social —
-- o suficiente pro form chamar HistoricoContratosFreela, que já tem
-- RPC própria (get_historico_contratos_freela) pra listar o histórico.

create or replace function public.freelancer_buscar_por_cpf(
  p_tenant_id uuid,
  p_cpf text
)
returns table(id uuid, nome_social text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_tenant_member(p_tenant_id) then
    return;
  end if;

  return query
  select f.id, f.nome_social
  from public.freelancers f
  where f.tenant_id = p_tenant_id
    and f.cpf = p_cpf
  limit 1;
end;
$$;

revoke all on function public.freelancer_buscar_por_cpf(uuid, text) from public, anon;
grant execute on function public.freelancer_buscar_por_cpf(uuid, text) to authenticated;
