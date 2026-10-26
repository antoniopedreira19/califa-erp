-- =============================================================================
-- O resultado por regional do histórico da planilha (decisão 211, A4)
-- =============================================================================
-- O relatório "Resultado por regional do histórico" refaz as linhas das abas
-- Gerencial da planilha a partir dos lançamentos do histórico: o lançamento
-- com regional entra na regional dele, o TD ("todas") se rateia pelo
-- percentual do ano e o resto fica sem regional. A regra das linhas fica no
-- código (`lib/historico-financeiro/regional.ts`); aqui ficam as somas de um
-- ano de competência, nas cargas ativas:
--   - por sigla do Tipo, grupo, trimestre, conta (a aba da planilha) e
--     regional, o crédito e o débito da planilha. A regional é o nome no
--     sistema, ou o código da coluna Reg quando o sistema não tem a regional
--     (a Urbia, "URB"); a tela decide se o código é de uma regional da empresa;
--   - o mesmo pela chave de empréstimo da coluna Jobs, só das chaves pedidas
--     (`p_prefixos`; a perda da FitDance), comparando o texto com as chaves
--     possíveis do ano, como a `historico_dre`;
--   - a tabela de rateio de todos os anos, com a origem de cada percentual,
--     para a tela mostrar o rateio de cada ano.
-- Devolve também o período que as cargas ativas cobrem.
--
-- SECURITY DEFINER com a trava de papel lida uma vez, como a `historico_dre`.
-- Sem o papel de admin ou financeiro, a função devolve nulo.
--
-- Mudança ADITIVA: só a função nova.
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
