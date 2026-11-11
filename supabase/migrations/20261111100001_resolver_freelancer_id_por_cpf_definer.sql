-- Fix: trigger resolver_freelancer_id_por_cpf deve rodar como SECURITY DEFINER
--
-- Contexto: a migration 20261103300001 criou o trigger pra resolver
-- freelancer_id a partir de cpf_freela na hora do INSERT em
-- freelancer_solicitacoes. A função nasceu `security invoker`, ou seja,
-- a subquery em public.freelancers roda com a RLS do usuário que fez o
-- insert.
--
-- Isso quebra pra GPs (e qualquer role que não seja admin/rh/financeiro):
-- as policies de SELECT em freelancers só liberam o cadastro pra
-- admin/rh/financeiro OU pra quem é responsavel_id do freela. Quando um
-- GP cria solicitação pra um freela que não é responsabilidade dele
-- (caso comum: freela migrado do RH antigo, responsável de outra equipe),
-- a subquery não enxerga o cadastro, freelancer_id fica NULL, e a
-- solicitação cai como "contratação" quando deveria ser "renovação" — e,
-- pior, na aprovação o fluxo não dispara criar_contrato_de_renovacao
-- porque depende de freelancer_id setado (actions.ts:224-228).
--
-- Caso real que motivou o fix: Teila (GP) criou solicitação pra Matheus
-- (CPF já cadastrado, com 2 contratos antigos do SEBRAE/HitLab de outro
-- responsável). freelancer_id ficou NULL, solicitação foi aprovada por
-- Marisa em 11/11/2026 e ficou presa — sem contrato, sem subir pra
-- Novidades, classificada como contratação em vez de renovação.
--
-- Mesma classe do incidente Bruna/Raquel (06/11/2026): RPC/trigger que
-- precisa ler toda a tabela rodando com RLS do usuário invés de bypass.
-- A aprovação daquela vez virou RPC SECURITY DEFINER (actions.ts:268-273);
-- este trigger tinha ficado de fora da revisão.
--
-- Fix: muda pra SECURITY DEFINER. Segurança cross-tenant continua
-- garantida pelo filtro `tenant_id = new.tenant_id` dentro da função —
-- e o `new.tenant_id` da solicitação é validado pelas policies de INSERT
-- em freelancer_solicitacoes antes do trigger rodar.
--
-- Mudança NÃO destrutiva: só altera atributo da função; comportamento
-- nas solicitações já gravadas (freelancer_id correto ou NULL) é
-- preservado. Backfill das órfãs fica numa migration separada.

create or replace function public.resolver_freelancer_id_por_cpf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.freelancer_id is null and new.cpf_freela is not null then
    select id into new.freelancer_id
    from public.freelancers
    where tenant_id = new.tenant_id
      and cpf = new.cpf_freela
    limit 1;
  end if;
  return new;
end;
$$;
