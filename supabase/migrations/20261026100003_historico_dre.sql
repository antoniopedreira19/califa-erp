-- =============================================================================
-- A DRE do histórico da planilha (decisão 211, A4)
-- =============================================================================
-- O relatório "DRE do histórico" refaz a DRE por competência das abas DRE da
-- planilha a partir dos movimentos do histórico. A regra das linhas (o sinal
-- de cada uma, as contas que entram, a ordem) fica no código
-- (`lib/historico-financeiro/dre.ts`); aqui ficam só as somas de um ano de
-- competência, nas cargas ativas:
--   - por sigla do Tipo, grupo, trimestre e conta (a aba da planilha): o
--     crédito e o débito da planilha, as colunas que as fórmulas SUMIFS somam;
--   - pela chave de empréstimo da coluna Jobs ("CMH 1T 2025"), trimestre e
--     conta, só das chaves pedidas (`p_prefixos`): a coluna Jobs guarda também
--     o nome dos jobs, que não entram na DRE.
-- Devolve também o período que as cargas ativas cobrem, para a tela dizer até
-- onde vai o histórico.
--
-- SECURITY DEFINER com a trava de papel lida uma vez, como a do Extrato: pela
-- RLS, a soma conferiria admin e financeiro em cada uma das dezenas de
-- milhares de linhas. Sem o papel, a função devolve nulo (a tela já é só de
-- admin e financeiro).
--
-- Mudança ADITIVA: só a função nova.
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
