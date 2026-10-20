-- View enxuta pro picker "Buscar freelancer" no dashboard do /freelancers.
--
-- Motivo: a RLS de `freelancers` tende a limitar quem GP/produtor vê (via
-- contratos). Pro picker funcionar, qualquer autenticado do tenant precisa ver
-- TODOS os freelas da agência — mas sem expor PII (CPF, RG, email, celular,
-- endereço, dados bancários, cartão CNPJ, dados de saúde) nem valor de
-- contrato.
--
-- SECURITY DEFINER (security_invoker=false) devolve só os campos seguros pra
-- qualquer authenticated do tenant. Dados sensíveis continuam atrás da RLS da
-- tabela base — só quem tem acesso lá vê CPF, email, etc.
--
-- status_vinculo colapsa o status real do contrato ativo mais recente em
-- 3 valores: 'ativo' | 'inativo' | 'sem_contrato'.
--   - 'ativo' = contrato status_real=true + janela corrente
--   - 'inativo' = contrato encerrado ou fora da janela
--   - 'sem_contrato' = freela cadastrado mas sem contrato nenhum

begin;

drop view if exists public.freelancers_lookup;

create view public.freelancers_lookup
with (security_invoker = false) as
select
  f.id,
  f.tenant_id,
  f.nome_social,
  f.nome_completo,
  c.cargo as cargo_contrato,
  c.nome_job,
  c.responsavel_id,
  p.nome as responsavel_nome,
  case
    when c.id is null then 'sem_contrato'
    when c.status_real = true
         and c.data_inicio is not null
         and c.data_inicio <= current_date
         and (c.data_termino is null or c.data_termino >= current_date)
      then 'ativo'
    else 'inativo'
  end as status_vinculo
from public.freelancers f
left join lateral (
  select
    co.id, co.cargo, co.nome_job, co.responsavel_id,
    co.status_real, co.data_inicio, co.data_termino, co.created_at
  from public.freelancer_contratos co
  where co.freelancer_id = f.id
    and co.tenant_id = f.tenant_id
  order by
    case when co.status_real then 0 else 1 end,
    co.data_inicio desc nulls last,
    co.created_at desc
  limit 1
) c on true
left join public.profiles p on p.id = c.responsavel_id;

-- Revoke todos os defaults e dá só SELECT pra authenticated.
-- A view SECURITY DEFINER roda com permissões do owner (postgres), então
-- bypassa RLS da tabela base. O filtro de tenant_id é responsabilidade do
-- consumidor (sempre fazer where tenant_id = ... na query).
revoke all on public.freelancers_lookup from anon;
revoke all on public.freelancers_lookup from authenticated;
grant select on public.freelancers_lookup to authenticated;

commit;
