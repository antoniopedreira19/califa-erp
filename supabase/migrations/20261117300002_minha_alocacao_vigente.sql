-- Decisão 264 (17/11/2026): o pedido de desembolso nasce com a empresa e a
-- regional de quem pede, lidas da alocação vigente no RH.
--
-- A tabela `colaboradores_alocacoes` só é lida por administrador e RH (dado
-- de pessoal). Quem pede um desembolso — GP, produtor, colaborador — precisa
-- só da própria alocação, e nada mais: esta função devolve a do usuário da
-- sessão (pelo `colaboradores.user_id`) e de ninguém além dele. Sem
-- alocação vigente, não devolve linha e o formulário pede a empresa e a
-- regional. `usa_rateio_empresa` (alocação sem regional, rateada pela
-- empresa) vai junto para a tela pedir a regional nesse caso.

create or replace function public.minha_alocacao_vigente()
returns table(empresa_id uuid, regional_id uuid, usa_rateio_empresa boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.empresa_id, a.regional_id, coalesce(a.usa_rateio_empresa, false)
    from public.colaboradores c
    join public.colaboradores_alocacoes a on a.colaborador_id = c.id and a.tenant_id = c.tenant_id
   where c.user_id = (select auth.uid())
     and c.tenant_id in (select public.current_tenant_ids())
     and a.data_inicio <= (now() at time zone 'America/Sao_Paulo')::date
     and (a.data_fim is null or a.data_fim >= (now() at time zone 'America/Sao_Paulo')::date)
   order by a.data_inicio desc
   limit 1
$function$;

revoke all on function public.minha_alocacao_vigente() from public, anon;
grant execute on function public.minha_alocacao_vigente() to authenticated;
