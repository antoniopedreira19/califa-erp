-- =============================================================================
-- O resultado por regional do histórico: o código da planilha (decisão 211, A4)
-- =============================================================================
-- Reaplica `historico_regional` (migrations 20261026100005 e 100006) com a
-- regional do lançamento que o cadastro do sistema não tem: quando não há
-- nome no sistema, a função devolve o código da coluna Reg da planilha, em
-- maiúsculas ("URB", da Urbia da CMH, que tem 25% do TD em 2023 e 2024). A
-- tela decide se o código é de uma regional da empresa; o resto continua sem
-- regional. Mesma assinatura; o arquivo 20261026100005 já traz esta versão.
--
-- Mudança ADITIVA: só a função, trocada pela mesma assinatura.
-- =============================================================================

create or replace function public.historico_regional(
  p_tenant_id uuid,
  p_ano integer,
  p_prefixos text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cargas    uuid[];
  v_cobertura jsonb;
  v_rateio    jsonb;
  v_grupos    jsonb;
  v_jobs      jsonb;
begin
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    return null;
  end if;

  select coalesce(array_agg(id), '{}'),
         case when count(*) = 0 then null
              else jsonb_build_object('de', min(periodo_de), 'ate', max(periodo_ate)) end
    into v_cargas, v_cobertura
    from public.historico_cargas
   where tenant_id = p_tenant_id and situacao = 'ativa';

  select coalesce(jsonb_agg(jsonb_build_object(
           'ano', r.ano, 'trimestre', r.trimestre, 'empresa', e.nome_fantasia, 'grupo', r.grupo,
           'regional', r.regional_nome, 'percentual', r.percentual, 'origem', r.origem)
           order by r.ano, e.nome_fantasia, r.trimestre nulls first, r.grupo nulls first, r.regional_nome), '[]'::jsonb)
    into v_rateio
    from public.historico_rateio_regional r
    join public.empresas e on e.id = r.empresa_id
   where r.tenant_id = p_tenant_id
     and r.carga_id = any(v_cargas);

  select coalesce(jsonb_agg(jsonb_build_object(
           'sigla', g.sigla, 'grupo', g.grupo, 'trimestre', g.trimestre, 'aba', g.aba,
           'regional', g.regional, 'todas', g.todas, 'credito', g.credito, 'debito', g.debito)), '[]'::jsonb)
    into v_grupos
    from (
      select coalesce(m.sigla_planilha, '') as sigla, m.grupo, m.competencia_trimestre as trimestre, m.aba,
             case when m.regional_todas then null
                  else coalesce(m.regional_nome, nullif(upper(btrim(m.regional_planilha)), '')) end as regional,
             m.regional_todas as todas,
             sum(coalesce(m.credito_planilha, 0)) as credito,
             sum(coalesce(m.debito_planilha, 0)) as debito
        from public.historico_movimentos m
       where m.tenant_id = p_tenant_id
         and m.carga_id = any(v_cargas)
         and m.competencia_ano = p_ano
         and m.competencia_trimestre is not null
         and m.grupo is not null
       group by 1, 2, 3, 4, 5, 6
    ) g;

  -- A chave de cada linha se calcula uma vez (CTE materializada), só nas linhas
  -- que têm a primeira palavra de alguma chave: a coluna guarda também o nome
  -- de milhares de jobs, e com poucas chaves o banco repetiria a conta por par.
  with candidatos as materialized (
    select m.aba,
           case when m.regional_todas then null
                else coalesce(m.regional_nome, nullif(upper(btrim(m.regional_planilha)), '')) end as regional,
           m.regional_todas as todas,
           coalesce(m.credito_planilha, 0) as credito,
           coalesce(m.debito_planilha, 0) as debito,
           upper(regexp_replace(btrim(m.coluna_jobs), '\s+', ' ', 'g')) as chave
      from public.historico_movimentos m
     where m.tenant_id = p_tenant_id
       and m.carga_id = any(v_cargas)
       and right(btrim(m.coluna_jobs), 4) = p_ano::text
       and upper(m.coluna_jobs) like any (array(select '%' || split_part(x, ' ', 1) || '%' from unnest(p_prefixos) as x))
  ), chaves as (
    select p.prefixo, t.trimestre::smallint as trimestre,
           p.prefixo || ' ' || t.trimestre || 'T ' || p_ano as chave
      from unnest(p_prefixos) as p(prefixo)
     cross join generate_series(1, 4) as t(trimestre)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'prefixo', j.prefixo, 'trimestre', j.trimestre, 'aba', j.aba,
           'regional', j.regional, 'todas', j.todas, 'credito', j.credito, 'debito', j.debito)), '[]'::jsonb)
    into v_jobs
    from (
      select k.prefixo, k.trimestre, c.aba, c.regional, c.todas,
             sum(c.credito) as credito, sum(c.debito) as debito
        from candidatos c
        join chaves k on k.chave = c.chave
       group by 1, 2, 3, 4, 5
    ) j;

  return jsonb_build_object('cobertura', v_cobertura, 'rateio', v_rateio, 'grupos', v_grupos, 'jobs', v_jobs);
end;
$$;

revoke all on function public.historico_regional(uuid, integer, text[]) from public, anon;
grant execute on function public.historico_regional(uuid, integer, text[]) to authenticated;
