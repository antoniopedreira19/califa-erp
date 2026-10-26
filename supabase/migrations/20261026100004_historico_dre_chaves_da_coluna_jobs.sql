-- =============================================================================
-- A DRE do histórico: a soma da coluna Jobs sem expressão regular (decisão 211, A4)
-- =============================================================================
-- Reaplica `historico_dre` (migration 20261026100003) com a soma da coluna
-- Jobs por comparação direta com as chaves do ano ("CMH 1T 2025"): a versão
-- aplicada primeiro passava a expressão regular em cada linha da coluna, que
-- guarda também o nome de milhares de jobs, e a função levava 1,4 s; assim,
-- 0,2 s. Mesma assinatura e mesmo resultado. O arquivo 20261026100003 já traz
-- esta versão; esta migration registra a reaplicação.
--
-- Mudança ADITIVA: só a função, trocada pela mesma assinatura.
-- =============================================================================

create or replace function public.historico_dre(
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

  -- As linhas do Tipo: o lerTipo da padronização já separou sigla, grupo e trimestre.
  select coalesce(jsonb_agg(jsonb_build_object(
           'sigla', g.sigla, 'grupo', g.grupo, 'trimestre', g.trimestre, 'aba', g.aba,
           'credito', g.credito, 'debito', g.debito)), '[]'::jsonb)
    into v_grupos
    from (
      select coalesce(m.sigla_planilha, '') as sigla, m.grupo, m.competencia_trimestre as trimestre, m.aba,
             sum(coalesce(m.credito_planilha, 0)) as credito,
             sum(coalesce(m.debito_planilha, 0)) as debito
        from public.historico_movimentos m
       where m.tenant_id = p_tenant_id
         and m.carga_id = any(v_cargas)
         and m.competencia_ano = p_ano
         and m.competencia_trimestre is not null
         and m.grupo is not null
       group by 1, 2, 3, 4
    ) g;

  -- As linhas da coluna Jobs: o texto em maiúsculas e com um espaço só, como
  -- `chaveDaColunaJobs` lê, igual a uma das chaves do ano ("CMH 1T 2025"). A
  -- comparação direta com as chaves possíveis evita a expressão regular em cada
  -- linha (a coluna guarda também o nome de milhares de jobs).
  select coalesce(jsonb_agg(jsonb_build_object(
           'prefixo', j.prefixo, 'trimestre', j.trimestre, 'aba', j.aba,
           'credito', j.credito, 'debito', j.debito)), '[]'::jsonb)
    into v_jobs
    from (
      select k.prefixo, k.trimestre, m.aba,
             sum(coalesce(m.credito_planilha, 0)) as credito,
             sum(coalesce(m.debito_planilha, 0)) as debito
        from public.historico_movimentos m
        join (
          select p.prefixo, t.trimestre::smallint as trimestre,
                 p.prefixo || ' ' || t.trimestre || 'T ' || p_ano as chave
            from unnest(p_prefixos) as p(prefixo)
           cross join generate_series(1, 4) as t(trimestre)
        ) k on k.chave = upper(regexp_replace(btrim(m.coluna_jobs), '\s+', ' ', 'g'))
       where m.tenant_id = p_tenant_id
         and m.carga_id = any(v_cargas)
         and right(btrim(m.coluna_jobs), 4) = p_ano::text
       group by 1, 2, 3
    ) j;

  return jsonb_build_object('cobertura', v_cobertura, 'grupos', v_grupos, 'jobs', v_jobs);
end;
$$;

revoke all on function public.historico_dre(uuid, integer, text[]) from public, anon;
grant execute on function public.historico_dre(uuid, integer, text[]) to authenticated;
