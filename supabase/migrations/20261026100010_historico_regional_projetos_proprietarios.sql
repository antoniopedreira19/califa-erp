-- =============================================================================
-- Os projetos proprietários no resultado por regional (decisão 211, A4)
-- =============================================================================
-- Decidido pelo Tiago em 26/10/2026: o resultado por regional segue o
-- Fechamento nos projetos proprietários — a Copa (os jobs com "COPA" na
-- coluna REGIONAL da aba Res. Jobs 2026) e os projetos da CCH (os com "CMH"
-- na Res. Jobs CMH 2026). Eles saem do faturamento, do imposto e do custo
-- operacional das regionais e entram num bloco abaixo do resultado, somados
-- só no lucro após investimento: a Copa metade no NE e metade no SP, os da
-- CCH na Doca, como as fórmulas do Fechamento ("DRE Califa Regional", linhas
-- 299 a 303; "DRE CMH Regional", linhas 249 a 253).
--
-- Reaplica `historico_regional` (a 20261026100008 traz a versão anterior)
-- com um campo a mais nas somas por grupo: `regional_do_job`, o texto da
-- coluna REGIONAL do job que a planilha não divide. A regra (quais textos são
-- projetos e como se dividem) fica em `lib/historico-financeiro/regional.ts`.
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

  -- O faturamento (REC) e o custo operacional (CO) do job que a planilha divide
  -- se dividem pelas partes dele, somadas a 1 (a regional vem como o código da
  -- planilha, "NE" ou "AGE"); o resto fica na regional do lançamento. No
  -- faturamento vai também o imposto teórico: o valor × a alíquota do job.
  -- Os movimentos se somam por job antes da divisão, e as partes de cada job
  -- se calculam uma vez (CTE materializada), e não uma vez por movimento. Do
  -- job que a planilha não divide vai também o texto da coluna REGIONAL das
  -- abas Res. Jobs ("COPA", "CMH"): a tela separa por ele os projetos
  -- proprietários.
  with partes as materialized (
    select j.carga_id, j.chave, e.key as codigo, e.value::numeric / s.soma as parte
      from public.historico_jobs j
     cross join lateral (select sum(v.value::numeric) as soma from jsonb_each_text(j.rateio_regional) as v) as s
     cross join lateral jsonb_each_text(j.rateio_regional) as e
     where j.tenant_id = p_tenant_id
       and j.carga_id = any(v_cargas)
       and s.soma <> 0
  ), somas as (
    select coalesce(m.sigla_planilha, '') as sigla, m.grupo, m.competencia_trimestre as trimestre, m.aba,
           case when m.regional_todas then null
                else coalesce(m.regional_nome, nullif(upper(btrim(m.regional_planilha)), '')) end as regional,
           m.regional_todas as todas, m.carga_id,
           case when m.grupo in ('REC', 'CO') then m.job_chave end as job_chave,
           sum(coalesce(m.credito_planilha, 0)) as credito,
           sum(coalesce(m.debito_planilha, 0)) as debito
      from public.historico_movimentos m
     where m.tenant_id = p_tenant_id
       and m.carga_id = any(v_cargas)
       and m.competencia_ano = p_ano
       and m.competencia_trimestre is not null
       and m.grupo is not null
     group by 1, 2, 3, 4, 5, 6, 7, 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sigla', g.sigla, 'grupo', g.grupo, 'trimestre', g.trimestre, 'aba', g.aba,
           'regional', g.regional, 'todas', g.todas, 'pelo_job', g.pelo_job,
           'regional_do_job', g.regional_do_job,
           'credito', g.credito, 'debito', g.debito, 'teorico', g.teorico)), '[]'::jsonb)
    into v_grupos
    from (
      select s.sigla, s.grupo, s.trimestre, s.aba,
             coalesce(p.codigo, s.regional) as regional,
             p.codigo is null and s.todas as todas,
             p.codigo is not null as pelo_job,
             case when p.codigo is null then nullif(upper(btrim(j.regional_planilha)), '') end as regional_do_job,
             sum(s.credito * coalesce(p.parte, 1)) as credito,
             sum(s.debito * coalesce(p.parte, 1)) as debito,
             sum(case when s.grupo = 'REC'
                      then (s.credito - s.debito) * coalesce(p.parte, 1) * coalesce(j.imposto_teorico_percentual, 0)
                      else 0 end) as teorico
        from somas s
        left join public.historico_jobs j on j.carga_id = s.carga_id and j.chave = s.job_chave
        left join partes p on p.carga_id = s.carga_id and p.chave = s.job_chave
       group by 1, 2, 3, 4, 5, 6, 7, 8
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
